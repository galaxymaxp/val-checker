export default function DashboardLoading() {
  return (
    <main aria-busy="true" aria-label="Loading dashboard" className="space-y-6">
      <span className="sr-only" role="status">
        Loading Riot accounts and storefronts…
      </span>
      <div className="h-28 animate-pulse rounded-panel border border-line bg-bg-card motion-reduce:animate-none" />
      <div className="h-52 animate-pulse rounded-panel border border-line bg-bg-card motion-reduce:animate-none" />
      <section className="space-y-6 rounded-panel border border-line bg-bg-card p-5 sm:p-7">
        <div className="h-12 w-64 max-w-full animate-pulse rounded-card bg-white/[0.07] motion-reduce:animate-none" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div
              className="min-h-72 animate-pulse rounded-card border border-line bg-white/[0.04] motion-reduce:animate-none"
              key={index}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
