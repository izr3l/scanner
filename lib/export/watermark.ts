export function drawWatermark(context: CanvasRenderingContext2D, text: string): void {
  const label = text.trim().slice(0, 120);
  if (!label) return;
  const { width, height } = context.canvas;
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate(-Math.PI / 6);
  context.globalAlpha = 0.22;
  context.fillStyle = '#111827';
  context.font = `600 ${Math.max(16, Math.min(width, height) / 17)}px Inter, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 0, 0, Math.sqrt(width * width + height * height) * 0.8);
  context.restore();
}
