import json,struct,numpy as np,sys
src,cell,out=sys.argv[1],float(sys.argv[2]),sys.argv[3]
f=open(src,'rb');f.read(12);l,_=struct.unpack('<II',f.read(8));j=json.loads(f.read(l));bl,_=struct.unpack('<II',f.read(8));buf=f.read(bl)
CT={5126:np.float32,5125:np.uint32,5123:np.uint16};NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}
def acc(i):
    a=j['accessors'][i];bv=j['bufferViews'][a['bufferView']];o=bv.get('byteOffset',0)+a.get('byteOffset',0);n=NC[a['type']];dt=CT[a['componentType']]
    st=bv.get('byteStride',0);isz=np.dtype(dt).itemsize*n
    if st and st!=isz:
        raw=np.frombuffer(buf,np.uint8,a['count']*st,o).reshape(a['count'],st)[:,:isz].copy();return raw.view(dt).reshape(a['count'],n)
    return np.frombuffer(buf,dt,a['count']*n,o).reshape(a['count'],n) if n>1 else np.frombuffer(buf,dt,a['count'],o)
M=np.array(j['nodes'][0]['matrix']).reshape(4,4).T
P=[];U=[];I=[];off=0
for nd in j['nodes'][2:]:
    for p in j['meshes'][nd['mesh']]['primitives']:
        if p.get('material')!=0: continue
        a=p['attributes'];pos=acc(a['POSITION']).astype(np.float64);uv=acc(a['TEXCOORD_0']).astype(np.float32)
        P.append(pos);U.append(uv);I.append(acc(p['indices']).astype(np.int64)+off);off+=len(pos)
P=np.vstack(P);U=np.vstack(U);I=np.concatenate(I).reshape(-1,3)
Pw=(np.c_[P,np.ones(len(P))]@M.T)[:,:3]
cx,cz=1.0,-1.0
fine=(Pw[:,0]>-6.2)&(Pw[:,0]<8.0)&(Pw[:,2]>-8.2)&(Pw[:,2]<6.2)&(Pw[:,1]<7.5)
q=np.where(fine[:,None],np.floor(Pw/cell),np.floor(Pw/float(sys.argv[4]))+10**6).astype(np.int64)
q=np.c_[q,fine.astype(np.int64)]
r=np.hypot(Pw[:,0]-cx,Pw[:,2]-cz);ring=(r>2)&(r<3.5)&(Pw[:,1]<1.0)
print('floor near well',np.median(Pw[ring,1]))
_,inv=np.unique(q,axis=0,return_inverse=True);inv=inv.ravel();K=inv.max()+1
cnt=np.bincount(inv,minlength=K).astype(np.float64)
nP=np.stack([np.bincount(inv,Pw[:,k],K) for k in range(3)],1)/cnt[:,None]
cen=Pw[I].mean(1);rr=np.hypot(cen[:,0]-cx,cen[:,2]-cz);floorY=np.median(Pw[ring,1])
well=(rr<1.25)&(cen[:,1]>floorY+0.06)
print('well tris',well.sum())
I=I[~well]
T=inv[I];ok=(T[:,0]!=T[:,1])&(T[:,1]!=T[:,2])&(T[:,0]!=T[:,2]);T=T[ok];I2=I[ok]
srt=np.sort(T,1);_,first=np.unique(srt,axis=0,return_index=True);T=T[first];I2=I2[first]
# smooth normals on clustered verts
a,b,c=nP[T[:,0]],nP[T[:,1]],nP[T[:,2]];fn=np.cross(b-a,c-a)
vn=np.zeros_like(nP)
for k in range(3):np.add.at(vn,T[:,k],fn)
vn/=np.linalg.norm(vn,axis=1,keepdims=True)+1e-9
pos=nP[T].reshape(-1,3).astype(np.float32);uv=U[I2].reshape(-1,2);nor=vn[T].reshape(-1,3)
print('tris',len(T),'bounds',pos.min(0),pos.max(0))
lo=pos.min(0);hi=pos.max(0);sc=(hi-lo)/65535
pq=np.round((pos-lo)/sc).astype(np.uint16)
uq=np.clip(np.round(uv*65535),0,65535).astype(np.uint16)
nq=np.clip(np.round(nor*127),-127,127).astype(np.int8)
hdr=json.dumps({'n':int(len(pos)),'lo':lo.tolist(),'sc':sc.tolist()}).encode()
with open(out,'wb') as o:
    o.write(struct.pack('<I',len(hdr)));o.write(hdr);o.write(b'\0'*((4-(4+len(hdr))%4)%4))
    o.write(pq.tobytes());o.write(uq.tobytes());o.write(nq.tobytes())
import os;print('bytes',os.path.getsize(out))
