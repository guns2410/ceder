import * as net from 'net'
import { ClientConnectionOptions } from './types'
import { Socket } from './Socket'
import assert = require('node:assert')

export class Client {
  protected readonly hostname: string
  protected readonly port: number

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

  async send<Data = unknown, Params = unknown>(handlerName: string, data: any, params: any): Promise<Record<string, any>> {
    const transactionId = this.getTransactionId()
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({
        port: this.port,
        host: this.hostname,
        timeout: this.options.timeout,
        noDelay: true,
      }, () => {
        if (this.options.log) {
          console.info(`Connected to ${this.serverAddress}. Sending request for ${handlerName}`)
        }
        const socket = new Socket(sock, false)
        socket.sendTransaction({ transactionId, data, handlerName, params })
        socket.once('timeout', () => {
          reject(new Error('Socket timeout'))
          socket.rawSocket.destroy()
        })

        const response = {} as Record<string, any>

        socket.on('data', (d) => {
          response[d.key] = d.data
        })

        socket.on('end', () => {
          resolve(response)
        })

      })
    })
  }

  protected getTransactionId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  }
}
