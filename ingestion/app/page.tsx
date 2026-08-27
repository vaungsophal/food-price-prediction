/**
 * A plain description of what this service is - and, just as importantly, what it is not.
 * The "not a live feed" framing is repeated wherever the data surfaces, because the single
 * easiest mistake to make with this dataset is to read a June price published in July as
 * today's market price.
 */

export default function HomePage() {
  return (
    <main className="wrap">
      <h1>Cambodia food-price data pipeline</h1>
      <p>
        A <strong>publication-updated</strong> ingestion service. It watches the WFP Cambodia
        market monitoring publication page, extracts the annex price tables from each new
        PDF, and stores them for human review before they become usable.
      </p>

      <p className="callout">
        This is not a real-time market-price feed. Observations appear only when WFP
        publishes a report, and the month a price refers to is normally earlier than the
        month the report came out.
      </p>

      <h2>Endpoints</h2>
      <ul>
        <li>
          <code>GET /api/prices</code> — approved observations only
        </li>
        <li>
          <code>GET /api/reports</code> — source report processing status
        </li>
        <li>
          <a href="/admin/observations">/admin/observations</a> — review queue (secret required)
        </li>
      </ul>
    </main>
  )
}
