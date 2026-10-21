import {expect,test} from 'vitest';
import {WorkerClient} from '../src/worker-client';
import type {Reply,Request} from '../src/worker-runtime';
class Port {
 messages:Request[]=[];onmessage?:({data}:{data:Reply})=>void;onerror?:({message}:{message:string})=>void;
 postMessage(request:Request){this.messages.push(request);}
 terminate(){}
 reply(index:number,extra:Partial<Reply>={}){const r=this.messages[index];this.onmessage?.({data:{epoch:r.epoch,request:r.request,...extra}});}
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
test('render frames cannot flood the worker with advance requests',async()=>{
 const port=new Port(),client=new WorkerClient(port as unknown as Worker);
 client.advance(.016);for(let i=0;i<20;i++)client.advance(.016);expect(port.messages).toHaveLength(1);
 port.reply(0);await flush();client.advance(.016);expect(port.messages).toHaveLength(2);
 expect(port.messages[1].command).toEqual({type:'advance',elapsed:expect.closeTo(.336,8)});
 port.reply(1);await flush();client.dispose();
});
test('late snapshots from before reset cannot replace the new scene',async()=>{
 const port=new Port(),client=new WorkerClient(port as unknown as Worker),seen:unknown[]=[];client.onSnapshot=s=>seen.push(s);
 const old=client.send({type:'step'}).catch(e=>e.message);
 const reset=client.send({type:'reset',scenario:{id:'empty',title:'',question:'',boxes:[]},diameter:8});
 port.reply(0);expect(await old).toBe('Superseded');expect(seen).toEqual([]);port.reply(1);await reset;client.dispose();
});
test('worker failure rejects commands and reports an error',async()=>{
 const port=new Port(),client=new WorkerClient(port as unknown as Worker);let message='';client.onError=e=>message=e.message;
 const waiting=client.send({type:'export'}).catch(e=>e.message);port.onerror?.({message:'stopped'});expect(await waiting).toBe('stopped');expect(message).toBe('stopped');client.dispose();
});
