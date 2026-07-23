ALTER TABLE public.stock_reservations
  DROP CONSTRAINT stock_reservations_serial_number_id_fkey;

ALTER TABLE public.stock_reservations
  ADD CONSTRAINT stock_reservations_serial_number_id_fkey
  FOREIGN KEY (serial_number_id)
  REFERENCES public.goods_receipt_serials(id)
  ON DELETE SET NULL;