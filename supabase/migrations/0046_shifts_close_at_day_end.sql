-- =============================================================================
-- 0046_shifts_close_at_day_end — a drawer left open overnight shuts itself
--
-- A shift that nobody closed at 11 pm stays open until somebody notices, and
-- tomorrow's first bills land in it. The float, the takings and the count then
-- describe two days at once, and the over-or-short answers nobody's question.
--
-- So when a shop's trading day ends, any drawer still open on it is closed by
-- the clock. For a shop on the default `day_ends_at` of 00:00 that is the
-- stroke of midnight — after 11:59 pm. A shop that cuts its books at 2 am has
-- its drawers closed at 2 am instead, because that shop is still ringing up
-- yesterday at 1 am and the register refuses to charge without an open shift:
-- closing at midnight would stop its till mid-queue.
--
-- **An automatic close is not a count.** Nobody opened the drawer, so
-- `closing_cash` and `over_short` stay null and `auto_closed` says why. What
-- the till expected, what went elsewhere and the bill count are stamped exactly
-- as `close_shift` stamps them, for the same reason: re-deriving them next
-- week would let a later refund rewritethem. Inventing a count — zero, or the
-- expected figure — would be a drawer that balanced because a machine said so.
--
-- **The count can still arrive.** A cashier whose close sheet was open across
-- midnight, or a manager counting last night's notes at 9 am, calls
-- `close_shift` on a shift the clock has already shut. Instead of handing back
-- the empty figures, it now records the count against the expected figure
-- stamped at the close, once. After that the shift is closed like any other.
--
-- No table is created and no policy is added; `shifts` keeps 0008's select
-- policy and its revoked writes. The sweep runs as the cron job's owner and is
-- revoked from everybody else.
-- =============================================================================

alter table public.shifts
  add column if not exists auto_closed boolean not null default false;

comment on column public.shifts.auto_closed is
  'True when the shift was closed by the end of the shop''s trading day rather than by somebody counting the drawer. closing_cash stays null until a count is recorded against it.';

-- -----------------------------------------------------------------------------
-- The sweep
--
-- A shift is stale when the trading day it opened on is behind the shop's
-- trading day now. Both are worked out the way `businessDayOf` in
-- `lib/pos/counter.ts` works them out — local time in the shop's own timezone,
-- less `day_ends_at` hours — and the two have to stay identical, or a drawer is
-- shut on a day the register still thinks it belongs to. A shop with no
-- `tenant_settings` row reads as `DEFAULT_SETTINGS`: Karachi, 00:00.
--
-- `skip locked`, so a cashier closing the drawer by hand at 00:00:30 is never
-- queued behind the sweep and never has their count thrown away: whichever
-- gets the row first wins, and the loser finds it closed.
-- -----------------------------------------------------------------------------
create or replace function private.close_stale_shifts()
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_shift record;
  v_cash numeric;
  v_other numeric;
  v_bills integer;
  v_expected numeric;
begin
  for v_shift in
    select sh.id, sh.tenant_id, sh.opening_float
      from public.shifts sh
      left join public.tenant_settings ts on ts.tenant_id = sh.tenant_id
     where sh.status = 'open'
       and ((sh.opened_at at time zone coalesce(ts.timezone, 'Asia/Karachi'))
              - make_interval(hours => left(coalesce(ts.day_ends_at, '00:00'), 2)::int))::date
         < ((now() at time zone coalesce(ts.timezone, 'Asia/Karachi'))
              - make_interval(hours => left(coalesce(ts.day_ends_at, '00:00'), 2)::int))::date
       for update of sh skip locked
  loop
    -- The same three figures `close_shift` works out, from the shift's own
    -- sales. Cash is what should be in the drawer; the rest never went in.
    select
        coalesce(sum(t.amount) filter (where t.method = 'cash'), 0),
        coalesce(sum(t.amount) filter (where t.method <> 'cash'), 0),
        count(distinct s.id) filter (where s.total >= 0)
      into v_cash, v_other, v_bills
      from public.sales s
      left join public.sale_tenders t
        on t.sale_id = s.id and t.tenant_id = v_shift.tenant_id
     where s.tenant_id = v_shift.tenant_id and s.shift_id = v_shift.id;

    v_expected := round(v_shift.opening_float + v_cash, 2);

    update public.shifts
       set status = 'closed',
           auto_closed = true,
           closed_at = now(),
           expected_cash = v_expected,
           card_total = v_other,
           bills = v_bills
     where id = v_shift.id;

    insert into public.audit_log (actor_kind, action, tenant_id, subject_type, subject_id, after)
    values (
      'system', 'shift.auto_closed', v_shift.tenant_id, 'shift', v_shift.id::text,
      jsonb_build_object(
        'reason', 'trading day ended', 'expected', v_expected,
        'card', v_other, 'bills', v_bills
      )
    );
  end loop;
end;
$fn$;

revoke execute on function private.close_stale_shifts() from public, anon, authenticated;

-- Every minute, so "after 11:59 pm" means 00:00 and not ten past. The query
-- touches open shifts only — a handful per shop at most.
select cron.schedule('flo-shift-day-end', '* * * * *',
  $$select private.close_stale_shifts()$$);

-- Shut anything already left open from an earlier day now.
select private.close_stale_shifts();

-- -----------------------------------------------------------------------------
-- close_shift learns to take a late count
--
-- Identical to 0032's version except for the branch on a closed shift: one
-- the clock shut and nobody has counted takes the count against the expected
-- figure it was stamped with. Its closed_at stays the moment the day ended —
-- that is when the drawer stopped taking money — and closed_by becomes the
-- person who counted it.
-- -----------------------------------------------------------------------------
create or replace function public.close_shift(
  p_tenant uuid, p_shift uuid, p_by uuid, p_counted numeric, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_shift public.shifts%rowtype;
  v_cash numeric;
  v_other numeric;
  v_bills integer;
  v_expected numeric;
begin
  if p_counted is null or p_counted < 0 or p_counted > 9999999 then
    raise exception 'a counted figure of % is not an amount', p_counted
      using errcode = '22023';
  end if;

  select * into v_shift
    from public.shifts
   where id = p_shift and tenant_id = p_tenant
     for update;

  if not found then
    raise exception 'shift % is not this shop''s', p_shift
      using errcode = 'restrict_violation';
  end if;

  if v_shift.status <> 'open' and v_shift.auto_closed and v_shift.closing_cash is null then
    update public.shifts
       set closed_by = p_by,
           closing_cash = round(p_counted, 2),
           over_short = round(p_counted, 2) - v_shift.expected_cash,
           note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note)
     where id = p_shift;

    return jsonb_build_object(
      'closed', true, 'expected', v_shift.expected_cash,
      'counted', round(p_counted, 2),
      'over_short', round(p_counted, 2) - v_shift.expected_cash,
      'card', v_shift.card_total, 'bills', v_shift.bills
    );
  end if;

  if v_shift.status <> 'open' then
    return jsonb_build_object(
      'closed', false, 'expected', v_shift.expected_cash,
      'counted', v_shift.closing_cash, 'over_short', v_shift.over_short,
      'card', v_shift.card_total, 'bills', v_shift.bills
    );
  end if;

  select
      coalesce(sum(t.amount) filter (where t.method = 'cash'), 0),
      coalesce(sum(t.amount) filter (where t.method <> 'cash'), 0),
      count(distinct s.id) filter (where s.total >= 0)
    into v_cash, v_other, v_bills
    from public.sales s
    left join public.sale_tenders t
      on t.sale_id = s.id and t.tenant_id = p_tenant
   where s.tenant_id = p_tenant and s.shift_id = p_shift;

  v_expected := round(v_shift.opening_float + v_cash, 2);

  update public.shifts
     set status = 'closed',
         closed_by = p_by,
         closed_at = now(),
         closing_cash = round(p_counted, 2),
         expected_cash = v_expected,
         over_short = round(p_counted, 2) - v_expected,
         card_total = v_other,
         bills = v_bills,
         note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note)
   where id = p_shift;

  return jsonb_build_object(
    'closed', true, 'expected', v_expected, 'counted', round(p_counted, 2),
    'over_short', round(p_counted, 2) - v_expected, 'card', v_other,
    'bills', v_bills
  );
end;
$fn$;

revoke execute on function public.close_shift(uuid, uuid, uuid, numeric, text)
  from public, anon, authenticated;
grant execute on function public.close_shift(uuid, uuid, uuid, numeric, text) to service_role;
