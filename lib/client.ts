import * as net from 'net'
import { ClientPassThrough } from './ClientPassthrough'
import assert = require('node:assert')

type ClientConnectionOptions = {
  timeout?: number
  log?: boolean
}

export class Client {
  private readonly hostname: string
  private readonly port: number

  constructor(private readonly serverAddress: string, private readonly options: ClientConnectionOptions) {
    this.serverAddress = serverAddress
    if (serverAddress.startsWith('http')) {
      throw new Error('Server address must be a TCP address')
    }

    if (!serverAddress.includes(':')) {
      throw new Error('Server address must include a port')
    }

    const [hostname, port] = serverAddress.split(':')
    assert(port, 'serverAddress must include a port. e.g. localhost:1337 or :1337')
    this.hostname = hostname || '0.0.0.0'
    this.port = +port
  }

  private static getTransactionId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  }

  async send<Data = unknown, Params = unknown>(handlerName: string, data: any, params: any): Promise<ClientPassThrough> {
    const transactionId = Client.getTransactionId()
    const passThrough = new ClientPassThrough({ log: this.options.log })
    const socket = net.createConnection({
      port: this.port,
      host: this.hostname,
      timeout: this.options.timeout,
    }, () => {
      if (this.options.log) {
        console.info(`Connected to ${this.serverAddress}. Sending request for ${handlerName}`)
      }
      socket.write(JSON.stringify({ transactionId, handlerName, data, params }))

      socket.on('error', (err) => {
        if (this.options.log) {
          console.error(err)
        }
        throw err
      })

      socket.pipe(passThrough)
    })

    return passThrough
  }
}
