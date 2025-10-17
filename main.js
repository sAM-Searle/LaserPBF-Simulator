// main.js
const ctx = document.getElementById("game").getContext("2d");
let t = 0;
function loop(ts) {
  t = ts / 1000;
  ctx.clearRect(0, 0, 800, 600);
  ctx.fillRect(400 + Math.sin(t) * 200, 300, 20, 20);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);