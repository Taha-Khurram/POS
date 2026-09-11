"use server";

import { headers } from "next/headers";

import { createAdminClient } from "@/utils/supabase/admin";

export type LeadState = { error: string | null; sent: boolean };

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function submitLead(_previous: LeadState, formData: FormData): Promise<LeadState> {
  const contactName = text(formData.get("name"));
  const phone = text(formData.get("phone"));
  const businessName = text(formData.get("business"));
  const email = text(formData.get("email"));
  const city = text(formData.get("city"));
  const shopType = text(formData.get("type"));
  const registers = text(formData.get("size"));
  const message = text(formData.get("notes"));

  if (!contactName || !phone || !businessName || !email) {
    return { error: "Enter your name, business, phone, and email.", sent: false };
  }

  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded && /^[0-9a-fA-F.:]+$/.test(forwarded) ? forwarded : null;
  const supabase = createAdminClient();
  const { error } = await supabase.from("leads").insert({
    contact_name: contactName,
    phone,
    business_name: businessName,
    email,
    city: city || null,
    shop_type: shopType || null,
    registers: registers || null,
    message: message || null,
    created_ip: ip,
  });

  if (error) {
    return { error: "We could not save your request. Please try again.", sent: false };
  }

  return { error: null, sent: true };
}
