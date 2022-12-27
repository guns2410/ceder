import * as UDP from 'node:dgram'
import * as EventEmitter from 'events'
import { HandlerOptions, SocketRequestData } from './types'

export class UDPServer extends EventEmitter {
  private server: UDP.Socket

  constructor() {
    super()
    this.server = UDP.createSocket('udp4')
    this.server.on('message', (msg, info) => {
      console.debug(`server got: ${msg} from ${info.address}:${info.port}`)
      if (!this.isValidRequest(msg)) {
        this.server.send('invalid request', info.port, info.address)
        return
      }

      const request = JSON.parse(msg.toString())
      const { handlerName, transactionId, data, params } = request as SocketRequestData

      let responseBuffer: Buffer = Buffer.from('')

      const doneFn = (data: Buffer) => this.server.send(Buffer.concat([responseBuffer, data]), info.port, info.address)
      const sendFn = (data: Buffer) => responseBuffer = Buffer.concat([responseBuffer, data])
      const errorFn = (err: Error) => this.server.send(JSON.stringify({
        transactionId: request.transactionId,
        isError: true,
        stack: err.stack,
        ...err,
      }), info.port, info.address)

      this.emit(handlerName, { transactionId, data, params, done: doneFn, send: sendFn, error: errorFn })
    })
  }

  public handle<Data, Params>(handlerName: string, options: HandlerOptions = {}, handler: (data: Data, params: Params, server: UDP.Socket) => any) {
    this.on(handlerName, async (incomingData: any) => {
      console.log('handle', handlerName, incomingData)
      try {
        const data = await handler(incomingData.data, incomingData.params, this.server)
        if (data) {
          if (data.metadata) {
            incomingData.send(Buffer.from(JSON.stringify(data.metadata)))
            incomingData.send('\r\n\r\n')
          }
          if (options.returnMode === 'stream') {
            await incomingData.pipe(data.data || data)
          } else {
            incomingData.done(Buffer.from(JSON.stringify(data.data || data)))
          }
        }
      } catch (err) {
        incomingData.error(err)
      }
    })
  }

  listen(port: number, hostname = 'localhost', callback?: () => void) {
    this.server.bind(port, hostname, callback)
  }

  private isValidRequest(data?: Buffer): data is Buffer {
    if (!data) return false
    try {
      const incomingData = JSON.parse(data.toString())
      return !!incomingData.handlerName
    } catch (err) {
      return false
    }
  }
}
