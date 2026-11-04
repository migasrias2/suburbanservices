/**
 * Runs tasks one after another. Every camera open goes through one queue, so
 * two getUserMedia calls never overlap (the Android camera HAL allows one
 * client per camera, and overlapping opens are the classic cause of a black
 * preview with the camera light on).
 */
export interface SerialQueue {
  run<T>(task: () => Promise<T>): Promise<T>
}

export const createSerialQueue = (): SerialQueue => {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task)
      tail = result.catch(() => undefined)
      return result
    },
  }
}
