"""Minimal FBX binary reader/writer: shrink or drop embedded textures."""
import struct, sys, zlib, io
from PIL import Image

def read_node(f, ver):
    W = 8 if ver >= 7500 else 4
    fmt = '<Q' if W == 8 else '<I'
    end = struct.unpack(fmt, f.read(W))[0]
    nprops = struct.unpack(fmt, f.read(W))[0]
    plen = struct.unpack(fmt, f.read(W))[0]
    nl = f.read(1)[0]
    if end == 0:
        return None
    name = f.read(nl).decode('latin1')
    props = []
    for _ in range(nprops):
        t = f.read(1).decode()
        if t in 'YCIFDL':
            sz = {'Y': 2, 'C': 1, 'I': 4, 'F': 4, 'D': 8, 'L': 8}[t]
            props.append((t, f.read(sz)))
        elif t in 'fdlib':
            hdr = f.read(12)
            alen, enc, clen = struct.unpack('<III', hdr)
            props.append((t, hdr + f.read(clen)))
        elif t in 'SR':
            n = struct.unpack('<I', f.read(4))[0]
            props.append((t, f.read(n)))
        else:
            raise ValueError('bad prop ' + t)
    kids = []
    while f.tell() < end:
        k = read_node(f, ver)
        if k is None:
            break
        kids.append(k)
    f.seek(end)
    return [name, props, kids]

def write_node(out, node, ver):
    W = 8 if ver >= 7500 else 4
    fmt = '<Q' if W == 8 else '<I'
    name, props, kids = node
    pb = io.BytesIO()
    for t, raw in props:
        pb.write(t.encode())
        if t in 'SR':
            pb.write(struct.pack('<I', len(raw)))
        pb.write(raw)
    pbytes = pb.getvalue()
    start = out.tell()
    out.write(b'\0' * (3 * W))
    out.write(bytes([len(name)]))
    out.write(name.encode('latin1'))
    out.write(pbytes)
    if kids:
        for k in kids:
            write_node(out, k, ver)
        out.write(b'\0' * (3 * W + 1))
    end = out.tell()
    out.seek(start)
    out.write(struct.pack(fmt, end) + struct.pack(fmt, len(props)) + struct.pack(fmt, len(pbytes)))
    out.seek(end)

def walk(nodes, fn):
    for n in nodes:
        fn(n)
        walk(n[2], fn)

def slim(src, dst, mode, maxpx=1024):
    data = open(src, 'rb').read()
    f = io.BytesIO(data)
    head = f.read(27)
    ver = struct.unpack('<I', head[23:27])[0]
    top = []
    while True:
        n = read_node(f, ver)
        if n is None:
            break
        top.append(n)
    stats = []
    def fix(n):
        if n[0] == 'Content':
            for i, (t, raw) in enumerate(n[1]):
                if t == 'R' and len(raw) > 1000:
                    if mode == 'drop':
                        n[1][i] = ('R', b'')
                    else:
                        try:
                            im = Image.open(io.BytesIO(raw))
                            im.load()
                            hasA = im.mode in ('RGBA', 'LA') and im.getextrema()[-1][0] < 250
                            im.thumbnail((maxpx, maxpx))
                            b = io.BytesIO()
                            if hasA:
                                im.save(b, 'PNG', optimize=True)
                            else:
                                im.convert('RGB').save(b, 'JPEG', quality=82)
                            if b.tell() < len(raw):
                                n[1][i] = ('R', b.getvalue())
                            stats.append((len(raw), b.tell(), hasA))
                        except Exception as e:
                            stats.append(('err', str(e)))
    walk(top, fix)
    out = io.BytesIO()
    out.write(head)
    for n in top:
        write_node(out, n, ver)
    W = 8 if ver >= 7500 else 4
    out.write(b'\0' * (3 * W + 1))
    # footer: copy original tail after the null record
    tail = data[f.tell():]
    out.write(tail[:16])
    pad = (16 - (out.tell() % 16)) % 16
    out.write(b'\0' * (pad or 16))
    out.write(tail[-144:])
    open(dst, 'wb').write(out.getvalue())
    return ver, stats, len(data), out.tell()

if __name__ == '__main__':
    src, dst, mode = sys.argv[1], sys.argv[2], sys.argv[3]
    print(slim(src, dst, mode, int(sys.argv[4]) if len(sys.argv) > 4 else 1024))

def anim_only(src, dst):
    data = open(src, 'rb').read()
    f = io.BytesIO(data); head = f.read(27); ver = struct.unpack('<I', head[23:27])[0]
    top = []
    while True:
        n = read_node(f, ver)
        if n is None: break
        top.append(n)
    tailpos = f.tell()
    objs = next(n for n in top if n[0] == 'Objects')
    drop = {'Geometry', 'Material', 'Texture', 'Video', 'Deformer', 'Pose'}
    keep, ids = [], {0}
    for o in objs[2]:
        typ = o[1][2][1].decode('latin1') if len(o[1]) > 2 else ''
        if o[0] in drop or (o[0] == 'Model' and typ == 'Mesh'):
            continue
        keep.append(o)
        ids.add(struct.unpack('<q', o[1][0][1])[0])
    objs[2] = keep
    conns = next(n for n in top if n[0] == 'Connections')
    ck = []
    for c in conns[2]:
        a = struct.unpack('<q', c[1][1][1])[0]; b = struct.unpack('<q', c[1][2][1])[0]
        if a in ids and b in ids: ck.append(c)
    conns[2] = ck
    out = io.BytesIO(); out.write(head)
    for n in top: write_node(out, n, ver)
    W = 8 if ver >= 7500 else 4
    out.write(b'\0' * (3 * W + 1))
    tail = data[tailpos:]
    out.write(tail[:16]); pad = (16 - (out.tell() % 16)) % 16; out.write(b'\0' * (pad or 16)); out.write(tail[-144:])
    open(dst, 'wb').write(out.getvalue())
    return len(keep), out.tell()
