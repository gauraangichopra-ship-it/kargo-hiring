export default function Loading() {
  return (
    <div className="space-y-3 animate-pulse" aria-busy="true">
      <div className="h-8 w-64 rounded bg-kargo/10" />
      <div className="h-20 rounded-xl bg-white/70" />
      <div className="h-96 rounded-xl bg-white/70" />
    </div>
  );
}
