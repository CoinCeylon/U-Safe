import { randomBytes } from 'node:crypto';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

const main = async (): Promise<void> => {
  const event = {
    type: 'test.event',
    id: `evt-${randomBytes(4).toString('hex')}`,
  };

  const response = await fetch(`${baseUrl}/api/events/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    throw new Error(`Publish failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { ok: boolean; event: { type: string; id: string } };
  console.log('Published event:');
  console.log(JSON.stringify(body, null, 2));
  console.log('Clients listening on /api/events should receive it.');
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
