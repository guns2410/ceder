import { Client } from './client'
import { ClientConnectionOptions } from './types'
import { ClientPassThrough } from './ClientPassthrough'
import { createSocket } from 'dgram'

export class UDPClient extends Client {

  constructor(url: string, options: ClientConnectionOptions) {
    super(url, options)
  }

  async send<Data = unknown, Params = unknown>(handlerName: string, data: any, params: any): Promise<ClientPassThrough> {
    const transactionId = this.getTransactionId()
    const passThrough = new ClientPassThrough({ log: this.options.log })
    return new Promise((resolve, reject) => {
      const socket = createSocket('udp4')
      socket.send(JSON.stringify({ transactionId, handlerName, data, params }), this.port, this.hostname, (err) => {
        if (err) {
          if (this.options.log) console.error(err)
          reject(err)
        }
        socket.on('message', (msg) => {
          console.log(msg.toString())
          passThrough.write(msg)
        })
        socket.on('error', (err) => {
          if (this.options.log) console.error(err)
          reject(err)
        })
        socket.on('close', () => {
          passThrough.end()
          resolve(passThrough)
        })
      })
    })
  }
}
