import { initialize } from './simulation';
import { WorkerRuntime, type Request, type Reply } from './worker-runtime';
const runtime = new WorkerRuntime();
const ready = initialize();
// A serial command stream: no reset/step/export can interleave with another.
let queue = ready;
self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  queue = queue.then(() => {
    let reply: Reply;
    try { reply = {epoch:request.epoch,request:request.request, ...runtime.execute(request.command)}; }
    catch(error) { reply = {epoch:request.epoch,request:request.request,error:(error as Error).message}; }
    const transfer = reply.snapshot ? [reply.snapshot.poses.buffer] : [];
    self.postMessage(reply, {transfer});
  }).catch(error => self.postMessage({epoch:request.epoch,request:request.request,error:String(error)}));
};
