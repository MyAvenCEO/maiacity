// @ts-nocheck
/** Own cancellable collection work until replacement or Studio destruction. */
export function collectionLifetime() {
 const active=new Map();let closed=false;
 return {
  /** @template T @param {string} key @param {(signal:AbortSignal)=>Promise<T>} read @returns {Promise<T>} */
  async run(key, read) {
   if(closed) throw new DOMException('Studio closed','AbortError');
   active.get(key)?.abort();
   const controller=new AbortController();active.set(key,controller);
   try {const result=await read(controller.signal);controller.signal.throwIfAborted();return result;}
   finally {if(active.get(key)===controller)active.delete(key);}
  },
  close(){closed=true;for(const controller of active.values())controller.abort();active.clear();}
 };
}
