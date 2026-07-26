-- Public inbound inquiries.
--
-- Replaces the `leads` marketing funnel, which is being cut. This table exists
-- purely to receive submissions from the public contact form and to preserve the
-- SMS consent record (sms_opt_in / sms_opt_in_at / consent_ip / consent_user_agent)
-- that TCPA compliance depends on.
--
-- ADDITIVE ONLY. Dropping `leads`, `lead_notes`, `lead_emails`, and
-- `lead_assignments` happens in a later migration, after all code referencing
-- them is gone.
--
-- Rows are written server-side with the service role; anon has no direct access.
-- Reads are admin-only, since this is a shared inbox rather than user-owned data.

CREATE TABLE public.inquiries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  message TEXT,
  source TEXT NOT NULL DEFAULT 'website',
  status TEXT NOT NULL DEFAULT 'new',
  sms_opt_in BOOLEAN NOT NULL DEFAULT false,
  sms_opt_in_at TIMESTAMPTZ,
  consent_ip TEXT,
  consent_user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX inquiries_created_idx ON public.inquiries (created_at DESC);

-- Supports the per-IP submission rate limit in api/public/lead-notify.
CREATE INDEX inquiries_consent_ip_created_idx ON public.inquiries (consent_ip, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inquiries TO authenticated;
GRANT ALL ON public.inquiries TO service_role;

ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage inquiries"
  ON public.inquiries FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
