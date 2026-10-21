import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import type {Box} from './simulation';
import type {BuildDefinition, BuildPart} from './shed';
import {boundsOf, escapeHtml as e, geometryDetails, mm, partsCatalog, partGeometryRecord, previewSpec, type PartGroup} from './parts-catalog';

export class PartsGallery {
  readonly scene=new THREE.Scene();
  readonly camera=new THREE.PerspectiveCamera(42,1,.01,2000);
  readonly controls:OrbitControls;
  groups:PartGroup[]=[];
  selected?:PartGroup;
  onSelect?:(ids:string[])=>void;
  private root=new THREE.Group();
  private dimensions=new THREE.Group();
  private tiles=new Map<string,THREE.Group>();
  private meshes:THREE.Mesh[]=[];
  private active=false;
  private extent=10;
  private chosenSpec?:Box;
  private filter='';
  constructor(private canvas:HTMLCanvasElement, private list:HTMLElement, private detail:HTMLElement, private summary:HTMLElement,
    private geometry:(spec:Box)=>THREE.BufferGeometry) {
    this.scene.background=new THREE.Color(0x192c27);
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x809589,2.5));
    const light=new THREE.DirectionalLight(0xffeed4,3);light.position.set(4,8,5);this.scene.add(light,this.root,this.dimensions);
    this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;this.controls.enabled=false;this.controls.minDistance=.3;
    list.addEventListener('click',event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-group]');if(button)this.select(button.dataset.group!,true);});
    detail.addEventListener('change',event=>{const select=event.target as HTMLSelectElement;if(select.id==='gallery-instance'&&this.selected){this.chosenSpec=this.selected.instances.find(p=>p.box.id===select.value)!.box;this.refreshTile(this.selected);this.showDetail();this.drawDimensions();}});
    detail.addEventListener('click',event=>{if((event.target as HTMLElement).closest('[data-focus]')&&this.selected)this.focus(this.selected.id);
      if((event.target as HTMLElement).closest('[data-download]')&&this.selected){
        const record=partGeometryRecord(this.selected,this.chosenSpec??this.selected.spec),url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download=`${this.selected.id}-${record.instanceId}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }});
    let down={x:0,y:0};
    canvas.addEventListener('pointerdown',event=>{down={x:event.clientX,y:event.clientY};});
    canvas.addEventListener('pointerup',event=>{
      if(!this.active||Math.hypot(event.clientX-down.x,event.clientY-down.y)>4)return;
      const rect=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),this.camera);
      const hit=ray.intersectObjects(this.meshes.filter(m=>m.parent?.visible))[0];if(hit)this.select(hit.object.userData.group);
    });
  }
  private dispose(group:THREE.Group) {
    group.traverse(object=>{const mesh=object as THREE.Mesh;if(mesh.geometry)mesh.geometry.dispose();const mats=mesh.material?(Array.isArray(mesh.material)?mesh.material:[mesh.material]):[];for(const mat of mats){(mat as THREE.SpriteMaterial).map?.dispose();mat.dispose();}});group.clear();
  }
  setPlan(plan:BuildPart[],definition?:BuildDefinition) {
    this.dispose(this.root);this.dispose(this.dimensions);this.tiles.clear();this.meshes=[];
    this.groups=partsCatalog(plan,definition);this.selected=undefined;this.chosenSpec=undefined;this.filter='';
    for(const group of this.groups) {const tile=new THREE.Group();this.tiles.set(group.id,tile);this.root.add(tile);this.refreshTile(group);}
    const permanent=this.groups.filter(g=>!g.temporary).reduce((s,g)=>s+g.quantity,0),temporary=this.groups.filter(g=>g.temporary).reduce((s,g)=>s+g.quantity,0);
    this.summary.textContent=`${this.groups.length} part types · ${permanent} permanent items${temporary?` · ${temporary} temporary support items`:''} · full recipe, including unplaced parts`;
    this.applyFilter('');if(this.groups[0])this.select(this.groups[0].id);else this.detail.textContent='No supplied parts in this recipe.';
  }
  setActive(active:boolean){this.active=active;this.controls.enabled=active;}
  resize(width:number,height:number){this.camera.aspect=width/height;this.camera.updateProjectionMatrix();}
  render(renderer:THREE.WebGLRenderer){this.controls.update();renderer.render(this.scene,this.camera);}
  private label(text:string,width=2.3,height=.34) {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#e9e3c6';ctx.font='600 48px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,48,500);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map,depthTest:false}));sprite.scale.set(width,height,1);return sprite;
  }
  private refreshTile(group:PartGroup) {
    const tile=this.tiles.get(group.id)!;this.meshes=this.meshes.filter(m=>m.parent!==tile);this.dispose(tile);
    const spec=previewSpec(this.selected===group?this.chosenSpec??group.spec:group.spec);
    const {min,max,size}=boundsOf(spec),scale=1.6/Math.max(...size);
    const mesh=new THREE.Mesh(this.geometry(spec),new THREE.MeshStandardMaterial({color:spec.renderPieces?0xffffff:spec.color,vertexColors:!!spec.renderPieces,roughness:.65,transparent:spec.opacity!==undefined,opacity:spec.opacity??1,side:THREE.DoubleSide}));
    mesh.scale.setScalar(scale);mesh.position.set(-(min.x+max.x)/2*scale,.12-min.y*scale,-(min.z+max.z)/2*scale);mesh.userData.group=group.id;tile.add(mesh);this.meshes.push(mesh);
    const outline=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry,20),new THREE.LineBasicMaterial({color:0x152923,transparent:true,opacity:.5}));outline.scale.copy(mesh.scale);outline.position.copy(mesh.position);tile.add(outline);
    const base=new THREE.Mesh(new THREE.BoxGeometry(2.2,.06,2.05),new THREE.MeshStandardMaterial({color:group.temporary?0x4a4030:0x30483e}));base.position.y=.025;tile.add(base);
    const label=this.label(`${group.id} · × ${group.quantity}${group.reusable?' reusable':''}`);label.position.set(0,2.02,0);tile.add(label);
  }
  applyFilter(value:string) {
    this.filter=value.toLowerCase();
    const visible=this.groups.filter(g=>`${g.id} ${g.name} ${g.spec.material} ${g.temporary?'temporary':'permanent'} ${g.instances.map(i=>i.box.id).join(' ')}`.toLowerCase().includes(this.filter));
    const cols=Math.max(1,Math.ceil(Math.sqrt(visible.length))),rows=Math.ceil(visible.length/cols);
    for(const tile of this.tiles.values())tile.visible=false;
    visible.forEach((g,i)=>{const tile=this.tiles.get(g.id)!;tile.visible=true;tile.position.set((i%cols-(cols-1)/2)*2.8,0,(Math.floor(i/cols)-(rows-1)/2)*2.8);});
    this.extent=Math.max(3,cols*2.8,rows*2.8);this.controls.maxDistance=this.extent*4;
    this.list.innerHTML=visible.map(g=>`<button class="part-card" data-group="${g.id}" aria-pressed="${this.selected===g}"><span class="part-card-top"><b>${g.id}</b><strong>× ${g.quantity}</strong></span><span>${e(g.name)}</span><small>${e(g.spec.material)}</small><span class="part-dimensions">${boundsOf(previewSpec(g.spec)).size.map(mm).join(' × ')} mm</span><small>${g.temporary?'Temporary support':'Permanent part'}${g.reusable?` · ${g.instances.length} placements`:''}</small></button>`).join('')||'<p>No matching parts.</p>';
    this.drawDimensions();this.setView('orbit');
  }
  select(id:string,focus=false) {
    this.selected=this.groups.find(g=>g.id===id);if(!this.selected)return;this.chosenSpec=this.selected.spec;this.refreshTile(this.selected);
    for(const mesh of this.meshes)(mesh.material as THREE.MeshStandardMaterial).emissive.setHex(mesh.userData.group===id?0x382b10:0);
    this.list.querySelectorAll<HTMLButtonElement>('[data-group]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.group===id)));
    this.showDetail();this.drawDimensions();this.onSelect?.(this.selected.instances.map(p=>p.box.id));if(focus)this.focus(id);
  }
  selectInstance(id:string){const group=this.groups.find(g=>g.instances.some(p=>p.box.id===id));if(group&&this.selected!==group)this.select(group.id);}
  private showDetail() {
    const g=this.selected!,spec=previewSpec(this.chosenSpec??g.spec);
    this.detail.innerHTML=`<h2>Part dimensions</h2><h3>${g.id} · ${e(g.name)}</h3><p class="gallery-count">${g.quantity} ${g.reusable?'reusable stands required':'required'}${g.reusable?` · ${g.instances.length} placements`:''}</p><p>${e(spec.material)} · ${g.massKg.toFixed(3)} kg each</p><dl><dt>Overall X × Y × Z · mm</dt><dd>${boundsOf(spec).size.map(mm).join(' × ')}</dd><dt>Role</dt><dd>${g.temporary?'Temporary support':'Permanent assembly item'}</dd></dl><label for="gallery-instance">Assembly instance${spec.telescopic?' / extension setting':''}</label><select id="gallery-instance">${g.instances.map(p=>`<option value="${e(p.box.id)}" ${p.box.id===spec.id?'selected':''}>${e(p.box.id)}${p.box.telescopic?` · ${mm(p.box.telescopic.heightM)} mm`:''}</option>`).join('')}</select><div class="gallery-detail-actions"><button data-focus>Focus this part</button><button data-download>Download part geometry (.json)</button></div>${geometryDetails(spec)}<p class="note">Download includes full-precision solid vertices and faces for later CAD conversion. Model dimensions in mm, displayed to 0.001 mm; this is not a manufacturing tolerance. Holes and hardware absent from the model are not invented. Local X / Y / Z correspond to the dimension lines.</p>`;
  }
  private drawDimensions() {
    this.dispose(this.dimensions);if(!this.selected)return;
    const tile=this.tiles.get(this.selected.id)!;if(!tile.visible)return;
    const {size}=boundsOf(previewSpec(this.chosenSpec??this.selected.spec)),s=1.6/Math.max(...size),[x,y,z]=size.map(n=>n*s);
    const lines:[THREE.Vector3,THREE.Vector3,string][]=[
      [new THREE.Vector3(-x/2,.1,z/2+.2),new THREE.Vector3(x/2,.1,z/2+.2),`X ${mm(size[0])} mm`],
      [new THREE.Vector3(x/2+.2,.12,-z/2),new THREE.Vector3(x/2+.2,.12+y,-z/2),`Y ${mm(size[1])} mm`],
      [new THREE.Vector3(-x/2-.2,.1,-z/2),new THREE.Vector3(-x/2-.2,.1,z/2),`Z ${mm(size[2])} mm`]];
    for(const [a,b,text] of lines){a.add(tile.position);b.add(tile.position);const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([a,b]),new THREE.LineBasicMaterial({color:0xf4d58d,depthTest:false}));this.dimensions.add(line);const label=this.label(text,1.15,.18);label.position.copy(a).add(b).multiplyScalar(.5);label.position.y+=.12;this.dimensions.add(label);}
  }
  focus(id:string){const p=this.tiles.get(id)!.position;this.controls.target.copy(p).add(new THREE.Vector3(0,.8,0));this.camera.position.copy(this.controls.target).add(new THREE.Vector3(3,2.5,4));this.controls.update();this.canvas.scrollIntoView({block:'center',behavior:'smooth'});}
  setView(view:string) {
    const direction=new THREE.Vector3(...(view==='top'?[0,1,.0001]:view==='side'?[0,.04,1]:[.55,.85,1]) as [number,number,number]).normalize();
    const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right);
    this.controls.target.set(0,.8,0);const tan=Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2));let distance=3;
    for(const tile of this.tiles.values())if(tile.visible)for(const x of [-1.25,1.25])for(const y of [0,2.25])for(const z of [-1.2,1.2]){
      const p=tile.position.clone().add(new THREE.Vector3(x,y,z)).sub(this.controls.target);
      distance=Math.max(distance,Math.abs(p.dot(right))/(tan*this.camera.aspect)+p.dot(direction),Math.abs(p.dot(up))/tan+p.dot(direction));
    }
    this.camera.far=Math.max(100,distance*10);this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.controls.target).addScaledVector(direction,distance*1.12);this.controls.update();
  }
}
