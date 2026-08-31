document.addEventListener('DOMContentLoaded', () => {
  const blob = document.querySelector('.blob-cursor');
  if (!blob) return;

  let mouseX = 0, mouseY = 0;
  let blobX = 0, blobY = 0;

  document.addEventListener('pointermove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  function animate() {
    blobX += (mouseX - blobX) * 0.15;
    blobY += (mouseY - blobY) * 0.15;
    blob.style.transform = `translate(${blobX - 20}px, ${blobY - 20}px)`;
    requestAnimationFrame(animate);
  }

  animate();
});