import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

// Barmoq soni -> shakl va rang (xohlaganingizcha o'zgartiring)
const SHAPES = {
  1: { color: 0x7dff9b, geo: () => new THREE.TetrahedronGeometry(1) },
  2: { color: 0xffe14d, geo: () => new THREE.OctahedronGeometry(1) },
  3: { color: 0xff9a3c, geo: () => new THREE.BoxGeometry(1.4, 1.4, 1.4) },
  4: { color: 0xff5fd2, geo: () => new THREE.DodecahedronGeometry(1) },
  5: { color: 0x5fd4ff, geo: () => new THREE.IcosahedronGeometry(1) },
};

// Neon wireframe: asosiy chiziq + biroz kattaroq xira nusxa (porlash effekti)
function makeShape(geo, color) {
  const group = new THREE.Group();
  const edges = new THREE.EdgesGeometry(geo);
  group.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color })));
  const glow = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending })
  );
  glow.scale.setScalar(1.05);
  group.add(glow);
  return group;
}

// Ochiq barmoqlar soni (qo'l burilishidan qat'i nazar ishlaydi)
function countFingers(lm) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let n = 0;
  [[8, 6], [12, 10], [16, 14], [20, 18]].forEach(([tip, pip]) => {
    if (d(lm[tip], lm[0]) > d(lm[pip], lm[0])) n++;
  });
  if (d(lm[4], lm[17]) > d(lm[3], lm[17])) n++; // bosh barmoq
  return n;
}

const palm = (lm) => ({
  x: (lm[0].x + lm[5].x + lm[17].x) / 3,
  y: (lm[0].y + lm[5].y + lm[17].y) / 3,
});

export default function App() {
  const videoRef = useRef(null);
  const mountRef = useRef(null);
  const [status, setStatus] = useState("Kamera ruxsati kutilmoqda...");
  const [fingers, setFingers] = useState(0);

  useEffect(() => {
    let raf, stream, landmarker, stopped = false, lastTime = -1, lastCount = -1;
    const video = videoRef.current;
    const mount = mountRef.current;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    camera.position.z = 6;

    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    const shapes = {};
    Object.entries(SHAPES).forEach(([k, s]) => {
      const g = makeShape(s.geo(), s.color);
      g.visible = false;
      scene.add(g);
      shapes[k] = g;
    });

    // Maqsad va joriy holat (silliq o'tish uchun lerp)
    const target = { pos: new THREE.Vector3(), scale: 0.01, roll: 0, count: 0 };
    const cur = { pos: new THREE.Vector3(), scale: 0.01, roll: 0 };
    let spin = 0;

    const worldSize = () => {
      const H = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
      return { W: H * camera.aspect, H };
    };

    const update = (hands) => {
      if (!hands.length) { target.count = 0; return; }
      const { W, H } = worldSize();
      const toWorld = (p) => new THREE.Vector3((0.5 - p.x) * W, (0.5 - p.y) * H, 0);
      const lm = hands[0];
      target.count = countFingers(lm);

      const p1 = toWorld(palm(lm));
      if (hands.length === 2) {
        // Ikki qo'l: shakl o'rtada, o'lcham qo'llar orasidagi masofaga qarab
        const p2 = toWorld(palm(hands[1]));
        target.pos.copy(p1).add(p2).multiplyScalar(0.5);
        target.scale = Math.max(0.3, p1.distanceTo(p2) * 0.5);
      } else {
        target.pos.copy(p1);
        // Qo'l kameraga yaqin bo'lsa katta ko'rinadi -> shakl ham kattalashadi
        const size = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y);
        target.scale = Math.max(0.2, size * 9);
      }
      const dx = -(lm[9].x - lm[0].x), dy = -(lm[9].y - lm[0].y);
      target.roll = Math.atan2(dy, dx) - Math.PI / 2;
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (landmarker && video.readyState >= 2 && video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        const res = landmarker.detectForVideo(video, performance.now());
        update(res.landmarks || []);
        if (target.count !== lastCount) { lastCount = target.count; setFingers(target.count); }
      }

      cur.pos.lerp(target.pos, 0.25);
      cur.scale += (target.scale - cur.scale) * 0.2;
      cur.roll += (target.roll - cur.roll) * 0.2;
      spin += 0.015;

      Object.entries(shapes).forEach(([k, g]) => {
        const on = Number(k) === target.count;
        g.visible = on;
        if (on) {
          g.position.copy(cur.pos);
          g.scale.setScalar(cur.scale);
          g.rotation.set(spin * 0.6, spin, cur.roll);
        }
      });
      renderer.render(scene, camera);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: "user" },
        });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        video.srcObject = stream;
        await video.play();
        setStatus("Model yuklanmoqda...");
        const fileset = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
        });
        if (stopped) return landmarker.close();
        setStatus("Tayyor");
        loop();
      } catch (e) {
        setStatus("Xato: " + e.message);
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      stream?.getTracks().forEach((t) => t.stop());
      landmarker?.close();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="stage">
      <video ref={videoRef} playsInline muted />
      <div className="three" ref={mountRef} />
      <div className="hud">
        {status} · Barmoq: {fingers}
        <br />
        1–5 barmoq = shakl · qo'l = joy · yaqin/uzoq = o'lcham · ikki qo'l = kattalashtirish
      </div>
    </div>
  );
}
