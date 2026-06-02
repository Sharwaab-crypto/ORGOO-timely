-- ════════════════════════════════════════════════════════════════════════
--  ТООЛЛОГЫН RLS ЗАСВАР
--  Алдаа: new row violates row-level security policy for "inv_stock_counts"
--
--  Шалтгаан: inv_stock_counts / inv_stock_count_items хүснэгтэд бичих
--  RLS policy дутуу. Тооллого хийдэг ажилтан (admin/manager/operator)
--  мөр нэмэх боломжгүй байна.
--
--  Шийдэл: Нэвтэрсэн (authenticated) хэрэглэгчдэд бүрэн эрх өгнө.
--
--  ХЭРЭГЛЭХ: Supabase Dashboard → SQL Editor → paste → RUN
-- ════════════════════════════════════════════════════════════════════════

-- ─── 1. inv_stock_counts ───
alter table public.inv_stock_counts enable row level security;

drop policy if exists "stock_counts select" on public.inv_stock_counts;
drop policy if exists "stock_counts insert" on public.inv_stock_counts;
drop policy if exists "stock_counts update" on public.inv_stock_counts;
drop policy if exists "stock_counts delete" on public.inv_stock_counts;

create policy "stock_counts select" on public.inv_stock_counts
  for select to authenticated using (true);
create policy "stock_counts insert" on public.inv_stock_counts
  for insert to authenticated with check (true);
create policy "stock_counts update" on public.inv_stock_counts
  for update to authenticated using (true) with check (true);
create policy "stock_counts delete" on public.inv_stock_counts
  for delete to authenticated using (true);

-- ─── 2. inv_stock_count_items ───
alter table public.inv_stock_count_items enable row level security;

drop policy if exists "stock_count_items select" on public.inv_stock_count_items;
drop policy if exists "stock_count_items insert" on public.inv_stock_count_items;
drop policy if exists "stock_count_items update" on public.inv_stock_count_items;
drop policy if exists "stock_count_items delete" on public.inv_stock_count_items;

create policy "stock_count_items select" on public.inv_stock_count_items
  for select to authenticated using (true);
create policy "stock_count_items insert" on public.inv_stock_count_items
  for insert to authenticated with check (true);
create policy "stock_count_items update" on public.inv_stock_count_items
  for update to authenticated using (true) with check (true);
create policy "stock_count_items delete" on public.inv_stock_count_items
  for delete to authenticated using (true);

-- ─── Шалгах: policy-ууд үүссэн эсэх ───
select tablename, policyname, cmd
from pg_policies
where tablename in ('inv_stock_counts', 'inv_stock_count_items')
order by tablename, cmd;
