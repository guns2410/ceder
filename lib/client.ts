import * as net from 'net'
import { PassThrough } from 'stream'

type ClientConnectionOptions = {
  port: number
  hostname?: string
  timeout?: number
}

type TransactionParams = {
  token?: string
  timeout?: number
}

type TransactionRequest = {
  transactionName: string
  data: unknown
  params: TransactionParams
}

interface ClientResponse extends PassThrough {
  json: <T>() => Promise<T>
  text: () => Promise<string>
}

export abstract class Client {
  private static isConnectionOpen: boolean = false

  private static async connect(options: ClientConnectionOptions): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      try {
        const socket = net.createConnection({
          port: options.port,
          host: options.hostname || 'localhost',
          timeout: options.timeout || 10000,
        }, () => {
          resolve(socket)
        })
      } catch (err) {
        reject(err)
      }
    })
  }

  private static getTransactionId(): string {
    const transactionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    return transactionId
  }

  static async send<T = unknown>(connectionOptions: ClientConnectionOptions, data: TransactionRequest): Promise<ClientResponse> {
    const transactionId = Client.getTransactionId()
    const socket = new net.Socket()
    socket.connect(connectionOptions.port, connectionOptions.hostname || 'localhost', () => {
      socket.write(JSON.stringify({
        transactionId,
        transactionName: data.transactionName,
        data: data.data,
        params: data.params,
      }))

      socket.on('error', (err) => {
        throw err
      })
    })

    const passThrough = new PassThrough() as ClientResponse
    socket.pipe(passThrough)

    passThrough.json = async () => {
      return new Promise((res, rej) => {
        let data = ''
        passThrough.on('data', (chunk) => {
          data += chunk
        })
        passThrough.on('end', () => {
          try {
          const incomingData = JSON.parse(data)
            if (incomingData) {
              if (incomingData.isError) {
                const err = new Error((incomingData.message || 'Unknown error'))
                Object.assign(err, incomingData)
                rej(err)
              } else {
                res(incomingData)
              }
            }
          } catch (err) {
            rej(err)
          }
        })
        passThrough.on('error', (err) => {
          rej(err)
        })
      })
    }

    passThrough.text = async () => {
      return new Promise((res, rej) => {
        let data = ''
        passThrough.on('data', (chunk) => {
          data += chunk
        })
        passThrough.on('end', () => {
          res(data)
        })
        passThrough.on('error', (err) => {
          rej(err)
        })
      })
    }

    return passThrough
  }

}
