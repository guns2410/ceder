import * as net from 'node:net'
import * as EventEmitter from 'node:events'
import * as assert from 'node:assert'

export class Server extends EventEmitter {
  private server: net.Server

  constructor() {
    super()
    this.server = net.createServer()
    this.server.on('connection', (socket) => {
      socket.on('data', (data) => {
        const incomingData = data.toString()
        if (incomingData === 'ping') {
          socket.end('pong')
        } else {
          try {
            const request = JSON.parse(data.toString())
            if (!request.handlerName) {
              socket.end('Invalid request')
            } else {

              this.emit(request.handlerName, {
                transactionId: request.transactionId,
                data: request.data,
                params: request.params,
                socket,
                pipe: (data: any) => socket.pipe(data),
                done: (data: any) => {
                  if (data) {
                    socket.end(data)
                  } else {
                    socket.end()
                  }
                },
                send: (data: any) => {
                  assert(data, 'Cannot send empty data')
                  socket.write(data)
                },
                error: (err: any) => {
                  socket.end({
                    transactionId: request.transactionId,
                    isError: true,
                    message: err.message,
                    stack: err.stack, ...err,
                  })
                },
              })
            }
          } catch (err) {
            console.error(err)
            socket.emit('error', err)
          }
        }
      })

      socket.on('error', (err) => {
        console.error(err)
        socket.destroy(err)
      })

    })
  }

  handle<Data, Params>(handlerName: string, handler: (data: Data, params: Params, socket: net.Socket) => any) {
    this.on(handlerName, async (incomingData: any) => {
      try {
        const data = await handler(incomingData.data, incomingData.params, incomingData.socket)
        if (data) {
          incomingData.done(Buffer.from(JSON.stringify(data)))
        }
      } catch (err) {
        incomingData.error(err)
      }
    })
  }

  listen(port: number, hostname = 'localhost', callback?: () => void) {
    this.server.listen(port, hostname, callback)
  }

  stop(callback?: () => void) {
    this.server.close(callback)
  }

}
