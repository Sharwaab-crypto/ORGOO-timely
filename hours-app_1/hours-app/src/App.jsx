-- ════════════════════════════════════════════════════════════════════════
--  ЗАХИАЛГАТАЙ "Тодорхойгүй" ДУУДЛАГЫН PAGE-ИЙГ ЗАХИАЛГААС НӨХӨХ
--
--  101 захиалгатай NULL дуудлага байна → тэдгээрийн утсаар захиалгын
--  fb_page_id-г олж дуудлагад тавина. Ингэснээр "Тодорхойгүй"-гээс гарна.
--
--  ХЭРЭГЛЭХ: SQL Editor → RUN
-- ════════════════════════════════════════════════════════════════════════

-- ─── 1. ЭХЛЭЭД ШАЛГАХ: захиалгаас page олдох NULL дуудлага хэд вэ ───
select count(distinct c.id) as "нөхөгдөх_дуудлага"
from public.biz_calls c
where c.fb_page_id is null
  and exists (
    select 1 from public.biz_orders o
    where o.customer_phone = c.phone and o.fb_page_id is not null
  );

-- ─── 2. НӨХӨХ: дуудлагын утсаар захиалгын page-ийг тавих ───
with phone_page as (
  select distinct on (o.customer_phone)
    o.customer_phone as phone, o.fb_page_id
  from public.biz_orders o
  where o.fb_page_id is not null
  order by o.customer_phone, o.created_at desc
)
update public.biz_calls c
set fb_page_id = pp.fb_page_id
from phone_page pp
where pp.phone = c.phone
  and c.fb_page_id is null;

-- ─── 3. Үлдсэн NULL дуудлага ───
select
  case when fb_page_id is null then 'NULL (Тодорхойгүй)' else 'Page-тэй' end as status,
  count(*) as call_count
from public.biz_calls
group by (fb_page_id is null);

-- ─── 4. Захиалгагүй үлдсэн NULL дуудлага устгах (4 ширхэг) ───
delete from public.biz_calls c
where c.fb_page_id is null
  and not exists (
    select 1 from public.biz_orders o where o.customer_phone = c.phone
  );
