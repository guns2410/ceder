import * as net from 'net'
import { ClientConnectionOptions } from './types'
import { Socket } from './Socket'
import { createPool, Pool } from 'generic-pool'
import assert = require('node:assert')

export class Client {
  protected readonly hostname: string
  protected readonly port: number
  private pool: Pool<Socket>

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

    this.pool = createPool({
      create: async () => {
        return await this.createSocketConnection()
      },
      validate: async (client: Socket): Promise<boolean>  => {
        return client.rawSocket.readable && client.rawSocket.writable
      },
      destroy: async (socket: Socket) => {
        socket.rawSocket.destroy()
      },
    }, {
      ...this.options.pool || {},
      testOnBorrow: true,
      testOnReturn: true,
      autostart: true,
    })
  }

  createSocketConnection(): Promise<Socket> {
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
        sock.setKeepAlive(true)
        const socket = new Socket(sock, false)
        resolve(socket)
      })

      sock.on('error', (err) => {
        reject(err)
      })
    })
  }

  async send<Data = unknown, Params = unknown>(handlerName: string, data: any, params: any): Promise<Record<string, any>> {
    await this.pool.ready()
    const transactionId = this.getTransactionId()
    return new Promise(async (resolve, reject) => {
      const socket = await this.pool.acquire()
      socket.sendTransaction({ transactionId, data, handlerName, params })

      const response = {} as Record<string, any>

      socket.on('data', (d) => {
        response[d.key] = d.data
      })

      socket.once('end', () => {
        socket.removeAllListeners()
        this.pool.release(socket)
        resolve(response)
      })

      socket.once('error', (err) => {
        socket.removeAllListeners()
        this.pool.destroy(socket)
        if ([ 'ECONNRESET', 'EPIPE' ].includes(err.code)) {
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
