import Process from 'node:child_process'
import { TextDecoder } from 'node:util'
import { ByteStream } from './stream.js'

/**
 * @typedef {object} Command
 * @property {string} model.program
 * @property {string[]} model.args
 * @property {Record<string, string|undefined>} model.env
 *
 * @typedef {object} Outcome
 * @property {Status} status
 * @property {string} output
 * @property {string} error
 *
 *
 * @param {string} program
 */
export const create = (program) =>
  new CommandView({
    program,
    args: [],
    env: process.env,
  })

class CommandView {
  /**
   * @param {Command} model
   */
  constructor(model) {
    this.model = model
  }

  /**
   * @param {string[]} args
   */
  args(args) {
    return new CommandView({
      ...this.model,
      args: [...this.model.args, ...args],
    })
  }

  /**
   * @param {Record<string, string|undefined>} env
   */
  env(env) {
    return new CommandView({
      ...this.model,
      env: { ...this.model.env, ...env },
    })
  }

  fork() {
    return fork(this.model)
  }

  join() {
    return join(this.model)
  }
}

/**
 * @param {Command} command
 */
export const fork = (command) => {
  const process = Process.spawn(command.program, command.args, {
    env: command.env,
  })
  return new Fork(process)
}

/**
 * @param {Command} command
 */
export const join = (command) => fork(command).join()

class Status {
  /**
   * @param {{code:number, signal?: void}|{signal:NodeJS.Signals, code?:void}} model
   */
  constructor(model) {
    this.model = model
  }

  success() {
    return this.model.code === 0
  }

  get code() {
    return this.model.code ?? null
  }
  get signal() {
    return this.model.signal ?? null
  }
}

class Fork {
  /**
   * @param {Process.ChildProcess} process
   */
  constructor(process) {
    this.process = process
    this.output = ByteStream.from(process.stdout ?? [])

    this.error = ByteStream.from(process.stderr ?? [])
  }
  join() {
    return new Join(this)
  }
  terminate() {
    this.process.kill()
    return this
  }
}

class Join {
  /**
   * @param {Fork} fork
   */
  constructor(fork) {
    this.fork = fork
    this.output = ''
    this.error = ''

    readInto(fork.output.reader(), this, 'output')
    readInto(fork.error.reader(), this, 'error')
  }

  /**
   * @param {(ok: Outcome) => unknown} succeed
   * @param {(error: Outcome) => unknown} fail
   */
  then(succeed, fail) {
    this.fork.process.once('close', (code, signal) => {
      const status =
        signal !== null
          ? new Status({ signal })
          : new Status({ code: /** @type {number} */ (code) })

      const { output, error } = this
      const outcome = { status, output, error }
      if (status.success()) {
        succeed(outcome)
      } else {
        fail(
          Object.assign(
            new Error(`command failed with status ${status.code}\n ${error}`),
            outcome
          )
        )
      }
    })
  }

  /**
   * @returns {Promise<Outcome>}
   */
  catch() {
    return Promise.resolve(this).catch((error) => error)
  }
}

// class Readable {
//   /**
//    * @param {AsyncIterable<Uint8Array>|Iterable<Uint8Array>} source
//    */
//   static from(source) {
//     const { readable, writable } = new TransformStream()
//     pipeInto(source, writable)
//     return new Readable(readable)
//   }
//   /**
//    * @param {ReadableStream<Uint8Array>} source
//    */
//   constructor(source) {
//     this.source = source
//   }
//   getReader() {
//     return new Reader(this.source.getReader())
//   }
//   async *[Symbol.asyncIterator]() {
//     const reader = this.getReader()
//     yield* reader
//     reader.releaseLock()
//   }
//   text() {
//     return this.getReader().text()
//   }
//   bytes() {
//     return this.getReader().bytes()
//   }
//   /**
//    * @param {number} size
//    */
//   chunks(size) {
//     return new Readable(this.source.pipeThrough(new SizedChunks(size)))
//   }
//   /**
//    * @param {number} byte
//    */
//   delimit(byte) {
//     return new Readable(this.source.pipeThrough(new DelimitedChunks(byte)))
//   }
//   lines() {
//     return this.delimit('\n'.charCodeAt(0))
//   }
//   take(n = 1) {
//     return this.getReader().take(n)
//   }
// }

// class Reader {
//   /**
//    * @param {ReadableStreamDefaultReader<Uint8Array>} source
//    */
//   constructor(source) {
//     this.source = source
//   }
//   read() {
//     return this.source.read()
//   }
//   releaseLock() {
//     return this.source.releaseLock()
//   }
//   cancel() {
//     return this.source.cancel()
//   }
//   get closed() {
//     return this.source.closed
//   }
//   async *[Symbol.asyncIterator]() {
//     while (true) {
//       const { value, done } = await this.read()
//       if (done) break
//       yield value
//     }
//   }

//   take(n = 1) {
//     return new Take(this, n)
//   }

//   async bytes() {
//     const chunks = []
//     let length = 0
//     for await (const chunk of this) {
//       chunks.push(chunk)
//       length += chunk.length
//     }

//     const bytes = new Uint8Array(length)
//     let offset = 0
//     for (const chunk of chunks) {
//       bytes.set(chunk, offset)
//       offset += chunk.length
//     }

//     return bytes
//   }
//   async text() {
//     return new TextDecoder().decode(await this.bytes())
//   }
// }

// class Take extends Reader {
//   /**
//    * @param {ReadableStreamDefaultReader<Uint8Array>} source
//    * @param {number} length
//    */
//   constructor(source, length) {
//     super(source)
//     this.length = length
//     this.offset = 0
//   }
//   /**
//    * @returns {Promise<ReadableStreamReadResult<Uint8Array>>}
//    */
//   async read() {
//     if (this.offset < this.length) {
//       this.offset++
//       const chunk = await this.source.read()
//       if (this.offset >= this.length) {
//         console.log('RELEASE LOCK')
//         this.source.releaseLock()
//       }
//       return chunk
//     } else {
//       return { done: true, value: undefined }
//     }
//   }
// }

// /**
//  * @extends {TransformStream<Uint8Array, Uint8Array>}
//  */
// class SizedChunks extends TransformStream {
//   /**
//    * @param {number} chunkSize
//    */
//   constructor(chunkSize) {
//     const buffer = new Uint8Array(chunkSize)
//     let offset = 0
//     super({
//       async transform(chunk, controller) {
//         if (offset + chunk.byteLength < chunkSize) {
//           buffer.set(chunk, offset)
//           offset += chunk.byteLength
//         } else {
//           buffer.set(chunk.slice(0, chunkSize - offset), offset)
//           await controller.enqueue(buffer.slice(0))

//           offset = chunkSize - offset
//           while (offset + chunkSize < chunk.byteLength) {
//             await controller.enqueue(chunk.subarray(offset, offset + chunkSize))
//             offset += chunkSize
//           }
//           buffer.set(chunk.subarray(offset), 0)
//           offset = chunk.byteLength - offset
//         }
//       },
//       flush(controller) {
//         controller.enqueue(buffer.subarray(0, offset))
//       },
//     })
//   }
// }

// /**
//  * @extends {TransformStream<Uint8Array, Uint8Array>}
//  */
// class DelimitedChunks extends TransformStream {
//   /**
//    * @param {number} delimiter
//    */
//   constructor(delimiter) {
//     let buffer = new Uint8Array(0)
//     super({
//       transform(bytes, controller) {
//         let start = 0
//         let end = 0
//         while (end < bytes.length) {
//           const byte = bytes[end]
//           end++
//           if (byte === delimiter) {
//             const segment = bytes.subarray(start, end)
//             if (buffer.length > 0) {
//               const chunk = new Uint8Array(buffer.length + segment.length)
//               chunk.set(buffer, 0)
//               chunk.set(segment, buffer.length)
//               controller.enqueue(chunk)
//             } else {
//               controller.enqueue(segment)
//             }
//             start = end
//           }
//         }

//         const segment = bytes.subarray(start, end)
//         const chunk = new Uint8Array(buffer.length + segment.length)
//         chunk.set(buffer, 0)
//         chunk.set(segment, buffer.length)
//         buffer = chunk
//       },
//       flush(controller) {
//         controller.enqueue(buffer)
//       },
//     })
//   }
// }
//
// /**
//  *
//  * @param {AsyncIterable<Uint8Array>|Iterable<Uint8Array>} source
//  * @param {WritableStream<Uint8Array>} destination
//  */
// const pipeInto = async (source, destination) => {
//   const writer = destination.getWriter()
//   try {
//     for await (const chunk of source) {
//       writer.write(chunk)
//     }
//     await writer.close()
//   } catch (error) {
//     await writer.abort(error)
//   } finally {
//     writer.releaseLock()
//   }
// }

/**
 * @template {string} Channel
 * @param {AsyncIterable<Uint8Array>} source
 * @param {{[key in Channel]: string}} output
 * @param {Channel} channel
 */
const readInto = async (source, output, channel) => {
  const decoder = new TextDecoder()
  for await (const chunk of source) {
    output[channel] += decoder.decode(chunk)
  }
}
