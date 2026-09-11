-- =============================================================================
-- 0006_rate_limits -- atomic server-side request throttling
--
-- Apply manually after 0005_order_verification_lock.sql. Only the service-role
-- server actions can execute the function; clients cannot inspect the table.
-- =============================================================================

create table public.request_rate_limits (
  scope text not null,
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash)
);

create index request_rate_limits_updated_at_idx
  on public.request_rate_limits (updated_at);

revoke all on public.request_rate_limits from anon, authenticated;
alter table public.request_rate_limits enable row level security;
alter table public.request_rate_limits force row level security;

create or replace function public.consume_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := clock_timestamp();
  v_window timestamptz;
  v_count integer;
begin
  if p_scope is null or length(btrim(p_scope)) = 0
     or p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$'
     or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit arguments' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_scope || ':' || p_key_hash, 0));

  select window_started_at, request_count
    into v_window, v_count
  from public.request_rate_limits
  where scope = p_scope and key_hash = p_key_hash
  for update;

  if not found or v_now >= v_window + (p_window_seconds * interval '1 second') then
    insert into public.request_rate_limits (scope, key_hash, window_started_at, request_count, updated_at)
    values (p_scope, p_key_hash, v_now, 1, v_now)
    on conflict (scope, key_hash) do update
      set window_started_at = excluded.window_started_at,
          request_count = excluded.request_count,
          updated_at = excluded.updated_at;
    return true;
  end if;

  if v_count >= p_limit then
    update public.request_rate_limits
      set updated_at = v_now
      where scope = p_scope and key_hash = p_key_hash;
    return false;
  end if;

  update public.request_rate_limits
    set request_count = request_count + 1,
        updated_at = v_now
    where scope = p_scope and key_hash = p_key_hash;
  return true;
end;
$fn$;

revoke execute on function public.consume_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer)
  to service_role;

comment on function public.consume_rate_limit(text, text, integer, integer) is
  'Atomic server-side throttle for public server actions keyed by a hashed client address.';
