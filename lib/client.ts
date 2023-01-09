import * as net from 'net'
import { ClientConnectionOptions } from './types'
import { Socket } from './Socket'
import assert = require('node:assert')

export class Client {
  protected readonly hostname: string
  protected readonly port: number
  private socket: net.Socket | undefined

  constructor(protected readonly serverAddress: string, protected readonly options: ClientConnectionOptions) {
    this.serverAddress = serverAddress
    if (serverAddress.startsWith('http')) {
      throw new Error('Server address must be a address. e.g. localhost:4867 or :4867')
    }

    if (!serverAddress.includes(':')) {
      throw new Error('Server address must include a port')
    }

    const [hostname, port] = serverAddress.split(':')
    assert(port, 'serverAddress must include a port. e.g. localhost:4867 or :4867')
    this.hostname = hostname || '0.0.0.0'
    this.port = +port
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({
        port: this.port,
        host: this.hostname,
        timeout: this.options.timeout,
        noDelay: true,
        keepAlive: true,
      }, () => {
        if (this.options.log) {
          console.info(`Connected to ${this.serverAddress}`)
        }
        this.socket = sock
        resolve()
      })

      sock.on('error', (err) => {
        reject(err)
      })
    })
  }

  async send<Data = unknown, Params = unknown>(handlerName: string, data: any, params: any): Promise<Record<string, any>> {
    const transactionId = this.getTransactionId()
    return new Promise(async (resolve, reject) => {
      if (!this.socket?.readable || !this.socket?.writable) {
        await this.connect()
      } else {
        this.socket.resume()
      }

      const socket = new Socket(this.socket!, false)
      socket.sendTransaction({ transactionId, data, handlerName, params })

      const response = {} as Record<string, any>

      socket.on('data', (d) => {
        response[d.key] = d.data
      })

      socket.once('end', () => {
        resolve(response)
      })

      socket.once('error', (err) => {
        if (err.message.includes('ECONNRESET')) {
          socket.reset()
          return this.send(handlerName, data, params)
        }
        reject(err)
      })
    })
  }

  protected getTransactionId(): string {
    return Math.random().toString(36).substring(2, 6) + Math.random().toString(36).substring(2, 6)
  }
}
