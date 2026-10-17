# Redis Caching Layer — Invoice Endpoints (#461)

Implemented Redis caching for `GET /invoices` and `GET /invoices/:id` to reduce database load.

## Configuration

| Env Var | Default | Description |
|---|---|---|
| `CACHE_ENABLED` | `true` | Toggle caching on/off |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `CACHE_TTL_INVOICES_LIST` | `30` | TTL in seconds for invoice listing |
| `CACHE_TTL_INVOICE_DETAIL` | `60` | TTL in seconds for invoice detail |

## Behaviour

- Cache hit returns response within 10ms with `X-Cache: HIT` header
- Cache miss fetches from DB, stores result, returns `X-Cache: MISS`
- Redis failure falls back to database transparently
- Mutations (create/update/status change) invalidate relevant cache keys
