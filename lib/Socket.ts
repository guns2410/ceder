import * as net from 'net'
import { SocketParsedData, SocketRequestData } from './types'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'events'
import { Readable } from 'stream'

export class Socket extends EventEmitter {
  private bufferedByes: number = 0
  private parsedData: Array<SocketParsedData> = []
  private unparsedData: SocketParsedData = {}
  private state: 'CONTENT_TYPE' | 'KEY_LENGTH' | 'KEY' | 'CONTENT_LENGTH' | 'PAYLOAD' | 'PARSE' = 'CONTENT_TYPE'
  private queue: Buffer[] = []
  private processData = false

  constructor(private readonly socket: net.Socket, private readonly isServer: boolean) {
    super()
    this.socket.on('error', this.onError.bind(this))
    this.socket.on('data', this.onData.bind(this))
    this.socket.on('close', () => {
      this.emit('close')
    })
    this.socket.on('end', () => {
      this.emit('end')
    })
  }

  reset() {
    this.bufferedByes = 0
    this.parsedData = []
    this.unparsedData = {}
    this.state = 'CONTENT_TYPE'
    this.queue = []
    this.processData = false
  }

  get rawSocket() {
    return this.socket
  }

  public rawWrite(data: any) {
    this.socket.write(data)
  }

  public sendTransaction(data: Omit<SocketRequestData, 'socket'>) {
    this.socket.write(JSON.stringify(data), (err) => {
      if (err) {
        console.error(err)
        this.emit('error', err)
      }
    })
  }

  public async sendStream(key: string, data: PassThrough) {
    if (this.isStream(data)) {
      await this.sendData(data, { key, type: 'stream' })
    } else {
      throw new Error('data is not a stream')
    }
  }

  public async sendBuffer(key: string, data: Buffer) {
    if (this.isBuffer(data)) {
      await this.sendData(data, { key, type: 'buffer' })
    } else {
      throw new Error('data is not a buffer')
    }
  }

  async send(key: string, data: any) {
    if (this.isStream(data)) {
      await this.sendStream(key, data)
    } else if (this.isBuffer(data)) {
      await this.sendBuffer(key, data)
    } else {
      await this.sendData(data, { key, type: 'data' })
    }
  }

  async done() {
    await this.sendData(1, { key: '$$__END__$$', type: 'data' })
  }

  private onError(err: Error) {
    console.error(err)
    this.socket.destroy(err)
    this.emit('error', err)
  }

  private onData(data: Buffer | string | any) {
    if (this.isServer) {
      this.onServerData(data)
    } else {
      this.onClientData(data)
    }
  }

  private onClientData(data: Buffer | string | any) {
    this.bufferedByes += data.length
    this.queue.push(data)
    this.processData = true
    this.parseData()
  }

  private parseData() {
    while (this.processData) {
      switch (this.state) {
        case 'CONTENT_TYPE':
          if (this.hasEnoughBytes(2)) {
            this.unparsedData.type = this.readBytes(2)?.readUInt16BE(0)
            this.state = 'KEY_LENGTH'
          }
          break
        case 'KEY_LENGTH':
          if (this.hasEnoughBytes(2)) {
            this.unparsedData.keyLength = this.readBytes(2)?.readUInt16BE(0)
            this.state = 'KEY'
          }
          break
        case 'KEY':
          if (this.hasEnoughBytes(this.unparsedData.keyLength!)) {
            this.unparsedData.key = this.readBytes(this.unparsedData.keyLength!)?.toString()
            this.state = 'CONTENT_LENGTH'
          }
          break
        case 'CONTENT_LENGTH':
          if (this.hasEnoughBytes(2)) {
            this.unparsedData.dataLength = this.readBytes(2)?.readUInt16BE(0)
            this.state = 'PAYLOAD'
          }
          break
        case 'PAYLOAD':
          if (this.hasEnoughBytes(this.unparsedData.dataLength || this.unparsedData.keyLength! + 6)) {
            this.unparsedData.data = this.unparsedData.dataLength && this.unparsedData.dataLength > 0 ?
              this.readBytes(this.unparsedData.dataLength) :
              this.readForKey(this.unparsedData.key!)

            if (this.unparsedData.isBodyParsed || this.unparsedData.dataLength! > 0) {
              this.parsedData.push(this.unparsedData)
              this.unparsedData = {}
              this.state = 'PARSE'
            }
          }
          break
        case 'PARSE':
          if (this.parsedData.length > 0) {
            const data = this.parsedData.shift()
            const actualData = data?.type === 1 ? data.data : JSON.parse(data?.data.toString())


            let key = data?.key
            if (key === '$$__END__$$' && actualData === 1) {
              this.emit('end')
              return
            } else {
              this.emit('data', { key, data: actualData })
            }
          }
          this.state = 'CONTENT_TYPE'
          break
        default:
          throw new Error(`Unknown state ${this.state}`)
      }
    }
  }

  private readBytes(size: number) {
    this.bufferedByes -= size
    if (size === this.queue[0].length) {
      return this.queue.shift()
    }
    if (size < this.queue[0].length) {
      const res = this.queue[0].subarray(0, size)
      this.queue[0] = this.queue[0].subarray(size)
      return res
    } else {
      let result = Buffer.alloc(size)
      let offset = 0
      let length
      while (size > 0) {
        length = this.queue[0].length
        if (size >= length) {
          this.queue[0].copy(result, offset)
          offset += length
          size -= length
          this.queue.shift()
        } else {
          this.queue[0].copy(result, offset, 0, size)
          this.queue[0] = this.queue[0].subarray(size)
          size = 0
        }
      }

      return result
    }
  }

  private readForKey(key: string) {
    const endState = `__end_${key}`
    const result = this.unparsedData.data || new PassThrough({ highWaterMark: 0 })
    let found = false
    let buffer: Buffer | undefined
    while (buffer = this.queue.shift()) {
      if (!buffer) continue
      this.bufferedByes -= buffer.length
      if (buffer.includes(endState)) {
        found = true
        this.unparsedData.isBodyParsed = true

        const index = buffer.indexOf(endState)
        result.end(buffer.subarray(0, index))
        this.queue.unshift(buffer.subarray(index + endState.length))
        break
      } else {
        result.write(buffer)
      }
    }

    return result
  }

  private hasEnoughBytes(size: number) {
    if (this.bufferedByes >= size) return true

    this.processData = false
    return false
  }

  private onServerData(data: Buffer | string | any) {
    const incomingData = data.toString()
    if (incomingData === 'ping') {
      this.socket.end('pong')
    }

    if (this.isValidRequest(data)) {
      const request = JSON.parse(data.toString()) as SocketRequestData
      request.socket = this
      this.emit('request', request)
    } else {
      this.socket.end('invalid request')
    }
  }

  private isValidRequest(data?: Buffer): data is Buffer {
    if (!data) return false
    try {
      const incomingData = JSON.parse(data.toString())
      return Boolean(incomingData.handlerName)
    } catch (err) {
      return false
    }
  }

  private async sendData(data: any, headers: any = {}) {
    if (!headers.key) {
      throw new Error('missing key')
    }

    if (!headers.type) {
      throw new Error('missing type')
    }

    const contentType = Buffer.alloc(2)
    const key = Buffer.from(headers.key)
    const keyLength = Buffer.alloc(2)
    keyLength.writeUInt16BE(key.length, 0)
    const dataLength = Buffer.alloc(2)

    let dataToSend = data

    switch (headers.type) {
      case 'stream':
        dataLength.writeUInt16BE(0, 0)
        contentType.writeUInt16BE(1, 0)
        break
      case 'buffer':
        dataLength.writeUInt16BE(data.length, 0)
        contentType.writeUInt16BE(2, 0)
        break
      default:
        dataToSend = Buffer.from(JSON.stringify(data))
        dataLength.writeUInt16BE(dataToSend.length, 0)
        contentType.writeUInt16BE(0, 0)
    }

    this.socket.write(contentType)
    this.socket.write(keyLength)
    this.socket.write(key)
    this.socket.write(dataLength)
    if (this.isStream(dataToSend)) {
      const passThrough = new Readable({
        highWaterMark: 128, read() {
        },
      })
      passThrough.wrap(dataToSend)
      await new Promise((resolve, reject) => {
        passThrough
          .on('data', (chunk: any) => {
            this.socket.write(chunk)
          })
          .once('end', () => this.socket.write(`__end_${headers.key}`))
          .once('error', (err: any) => reject(err))
          .once('close', () => resolve(null))
      })
    } else {
      this.socket.write(dataToSend)
    }
  }

  private isBuffer(data: any): data is Buffer {
    return Buffer.isBuffer(data)
  }

  private isStream(data: any): data is PassThrough {
    return typeof data === 'object' && data !== null && typeof data.pipe === 'function'
  }

}
