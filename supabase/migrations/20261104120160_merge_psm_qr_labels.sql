-- Merge PSM into one client (Miguel and the client, 2026-11-04: "they are both
-- the same one"). PSM Marine's 16 QR codes were labelled "PSM" / "Psm" while
-- the client record, James Spenceley's login, Mosleen's site link and the 90
-- area tasks all say "PSM Marine", so the app showed two clients.
--
-- Relabels those QR codes to "PSM Marine": the customer_name column and the
-- customerName inside the stored payload (qr_code_url), which is what the
-- scanner reads. Nothing is deleted and the QR ids are unchanged, so the
-- printed stickers keep working: the scanner finds the code by id first.
-- Payload text is edited in place (not re-serialised) so its format is kept.
--
-- Not changed: past attendance and scan logs still say "PSM". The "PSM" scope
-- alias (20261104120150) keeps those visible to PSM's client login.

do $$
declare
  v_updated int;
begin
  update public.building_qr_codes
     set customer_name = 'PSM Marine',
         qr_code_url = replace(
                         replace(qr_code_url, '"customerName":"PSM"', '"customerName":"PSM Marine"'),
                         '"customerName":"Psm"', '"customerName":"PSM Marine"')
   where lower(btrim(customer_name)) = 'psm';
  get diagnostics v_updated = row_count;
  raise notice 'PSM QR codes relabelled to "PSM Marine": %', v_updated;

  if exists (
    select 1 from public.building_qr_codes
    where lower(btrim(customer_name)) = 'psm'
       or qr_code_url ~* '"customerName"\s*:\s*"psm"'
  ) then
    raise exception 'Some PSM QR codes still say "PSM"; nothing was changed';
  end if;
end
$$;
