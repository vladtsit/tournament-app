// Optional Application Insights wiring. Initialised only when
// APPLICATIONINSIGHTS_CONNECTION_STRING is set, so local/dev runs stay zero-cost.
// SWA Free tier accepts the App Insights Free 1 GB/month quota — we keep
// sampling on and explicitly disable noisy collectors.

let started = false;

export function maybeStartTelemetry(): void {
  if (started) return;
  const conn = process.env["APPLICATIONINSIGHTS_CONNECTION_STRING"];
  if (!conn || conn.length === 0) return;
  started = true;
  // Lazy import so installs without the env var don't pay the cold-start cost.
  void import("applicationinsights")
    .then((appInsights) => {
      appInsights
        .setup(conn)
        .setAutoCollectRequests(true)
        .setAutoCollectDependencies(false)
        .setAutoCollectExceptions(true)
        .setAutoCollectPerformance(false, false)
        .setAutoCollectConsole(false)
        .setSendLiveMetrics(false)
        .setInternalLogging(false, false)
        .start();
      // Tag every event with a cloud role for the Application Map.
      appInsights.defaultClient.context.tags[
        appInsights.defaultClient.context.keys.cloudRole
      ] = "padel-api";
    })
    .catch(() => {
      // Telemetry is best-effort; never crash the function host.
    });
}
