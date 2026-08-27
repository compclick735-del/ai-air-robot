const blobs = document.querySelectorAll('.blob-cursor');

window.addEventListener('pointermove', (e) => {
  blobs.forEach((blob, index) => {
    gsap.to(blob, {
      x: e.clientX - 20,
      y: e.clientY - 20,
      duration: 0.2 + index * 0.1,
      ease: "power2.out"
    });
  });
});