const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export async function initScene() {
  const canvas = document.querySelector("#motionField");
  if (!canvas || reducedMotion.matches || !window.WebGLRenderingContext) return;

  try {
    const THREE = await import("/vendor/three/three.module.js");
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 8.8);

    const world = new THREE.Group();
    world.position.set(2.15, 0.25, 0);
    scene.add(world);

    const coral = new THREE.Color(0xff7657);
    const lavender = new THREE.Color(0xb9b5ff);
    const aqua = new THREE.Color(0x90ded4);
    const softMaterial = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, wireframe: true, depthWrite: false });

    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.66, 1), softMaterial(coral, 0.74));
    const innerCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 1), new THREE.MeshBasicMaterial({ color: aqua, transparent: true, opacity: 0.62, wireframe: true, depthWrite: false }));
    world.add(core, innerCore);

    const ringGroup = new THREE.Group();
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.018, 8, 80), softMaterial(lavender, 0.58));
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.012, 8, 80), softMaterial(aqua, 0.42));
    const ringC = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.009, 8, 80), softMaterial(coral, 0.34));
    ringA.rotation.set(0.95, 0.22, 0.08);
    ringB.rotation.set(1.22, -0.35, -0.12);
    ringC.rotation.set(0.35, 0.72, 0.18);
    ringGroup.add(ringA, ringB, ringC);
    world.add(ringGroup);

    const particleCount = Math.min(180, Math.max(90, Math.round(window.innerWidth / 7)));
    const particlePositions = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) {
      const radius = 2.1 + Math.random() * 2.8;
      const angle = Math.random() * Math.PI * 2;
      particlePositions[index * 3] = Math.cos(angle) * radius * (0.85 + Math.random() * 0.5);
      particlePositions[index * 3 + 1] = (Math.random() - 0.5) * 3.2;
      particlePositions[index * 3 + 2] = (Math.random() - 0.5) * 2.2;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({ color: lavender, size: 0.026, transparent: true, opacity: 0.68, sizeAttenuation: true, depthWrite: false });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    world.add(particles);

    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    const onPointerMove = (event) => {
      pointer.targetX = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 0.48;
      pointer.targetY = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 0.28;
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(bounds.width, 1);
      const height = Math.max(bounds.height, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    let visible = true;
    let frame = 0;
    let startedAt = performance.now();
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible && !frame) { startedAt = performance.now(); frame = requestAnimationFrame(render); } }, { threshold: 0 });
    observer.observe(canvas);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("resize", resize, { passive: true });

    function render(time) {
      if (!visible || document.hidden) { frame = 0; return; }
      const elapsed = (time - startedAt) / 1000;
      pointer.x += (pointer.targetX - pointer.x) * 0.025;
      pointer.y += (pointer.targetY - pointer.y) * 0.025;
      world.rotation.y = elapsed * 0.11 + pointer.x * 0.18;
      world.rotation.x = pointer.y * 0.12;
      ringGroup.rotation.z = -elapsed * 0.18;
      ringGroup.rotation.y = elapsed * 0.08;
      core.rotation.x = elapsed * 0.22;
      core.rotation.y = elapsed * 0.34;
      innerCore.rotation.x = -elapsed * 0.48;
      innerCore.rotation.z = elapsed * 0.26;
      particles.rotation.y = -elapsed * 0.035;
      particles.rotation.z = Math.sin(elapsed * 0.2) * 0.035;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    }

    resize();
    frame = requestAnimationFrame(render);
  } catch (_) {
    canvas.style.display = "none";
  }
}
