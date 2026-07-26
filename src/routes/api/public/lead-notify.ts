// Public inbound inquiry endpoint.
//
// Slimmed during the SpaAI cut. What it used to do and no longer does:
//   - insert into `leads` (cut) -> now writes to `inquiries`
//   - parse city/neighborhood/state/zip out of the message body (location-parse, deleted)
//   - render + enqueue the `new-lead-alert` email (template deleted)
//
// What it deliberately still does: honeypot, per-IP rate limiting, and the full
// SMS consent record. Those are compliance-relevant, not funnel features.
//
// The route path stays /api/public/lead-notify so the public form keeps working;
// renaming it is cosmetic and can happen with the rest of the branding pass.

import { createClient } from '@supabase/supabase-js'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

const schema = z.object({
  full_name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().min(7).max(30),
  message: z.string().trim().max(2000).optional(),
  source: z.string().trim().max(80).optional(),
  sms_opt_in: z.boolean().optional(),
  // Honeypot: real users leave this empty. Bots fill every field.
  website: z.string().max(0).optional().or(z.literal('')),
})

export const Route = createFileRoute('/api/public/lead-notify')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = process.env.SUPABASE_URL
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !serviceKey) {
          return Response.json({ error: 'Server configuration error' }, { status: 500 })
        }

        const rawBody = await request.text().catch(() => '')
        if (rawBody.length > 8_000) {
          return Response.json({ error: 'Payload too large' }, { status: 413 })
        }
        let body: unknown
        try {
          body = JSON.parse(rawBody)
        } catch {
          return Response.json({ error: 'Invalid JSON' }, { status: 400 })
        }
        const parsed = schema.safeParse(body)
        if (!parsed.success) {
          return Response.json({ error: 'Invalid payload' }, { status: 400 })
        }
        const data = parsed.data

        // Honeypot triggered — silently accept so bots don't learn.
        if (data.website) {
          return Response.json({ success: true })
        }

        const fwd = request.headers.get('x-forwarded-for') ?? ''
        const ip =
          fwd.split(',')[0]?.trim() ||
          request.headers.get('cf-connecting-ip') ||
          request.headers.get('x-real-ip') ||
          null
        const ua = request.headers.get('user-agent')?.slice(0, 500) ?? null

        const supabase = createClient(supabaseUrl, serviceKey)

        // IP rate limit: max 5 submissions per hour per source IP.
        if (ip) {
          const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
          const { count } = await supabase
            .from('inquiries')
            .select('id', { count: 'exact', head: true })
            .eq('consent_ip', ip)
            .gte('created_at', since)
          if ((count ?? 0) >= 5) {
            return Response.json(
              { error: 'Too many submissions. Try again later.' },
              { status: 429 },
            )
          }
        }

        // Server-side insert — anon has no direct access to this table.
        const { data: inserted, error: insertErr } = await supabase
          .from('inquiries')
          .insert({
            full_name: data.full_name,
            email: data.email,
            phone: data.phone,
            message: data.message ?? null,
            source: data.source ?? 'website',
            sms_opt_in: data.sms_opt_in ?? false,
            sms_opt_in_at: data.sms_opt_in ? new Date().toISOString() : null,
            consent_ip: ip,
            consent_user_agent: ua,
          })
          .select('id')
          .single()
        if (insertErr || !inserted) {
          return Response.json({ error: 'Could not submit' }, { status: 500 })
        }

        return Response.json({ success: true, inquiry_id: inserted.id })
      },
    },
  },
})
