import { parentPort, workerData } from 'node:worker_threads'
import * as PieceHasher from 'fr32-sha2-256-trunc254-padded-binary-tree-multihash'

const hasher = PieceHasher.create()
hasher.write(workerData)

const bytes = new Uint8Array(hasher.multihashByteLength())
hasher.digestInto(bytes, 0, true)
hasher.free()

parentPort?.postMessage(bytes)
