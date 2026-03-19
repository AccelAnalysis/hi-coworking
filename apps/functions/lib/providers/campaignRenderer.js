"use strict";
/**
 * Renders campaign messages for different job types and channels.
 * In production, these templates would be stored in Firestore or a CMS;
 * this module provides sensible defaults for all job types.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderEmailSubject = renderEmailSubject;
exports.renderEmailHtml = renderEmailHtml;
exports.renderSmsBody = renderSmsBody;
exports.renderPushTitle = renderPushTitle;
exports.renderPushBody = renderPushBody;
function renderEmailSubject(jobType, ctx) {
    const title = ctx.eventTitle || "Upcoming Event";
    switch (jobType) {
        case "announce":
            return ctx.copyVariants?.emailSubject || `You're invited: ${title}`;
        case "reminder":
            return ctx.copyVariants?.reminderSubject || `Reminder: ${title} is coming up`;
        case "starting_soon":
            return ctx.copyVariants?.startingSoonSubject || `Starting soon: ${title}`;
        case "follow_up":
            return ctx.copyVariants?.followUpSubject || `Thanks for attending ${title}!`;
        default:
            return title;
    }
}
function renderEmailHtml(jobType, ctx) {
    const name = ctx.recipientName || "there";
    const title = ctx.eventTitle || "our upcoming event";
    const date = ctx.eventDate || "";
    const location = ctx.eventLocation || "";
    const url = ctx.eventUrl || "https://hi-coworking.com/events";
    const header = `<div style="background:#0f172a;color:#fff;padding:24px 32px;border-radius:12px 12px 0 0;"><h1 style="margin:0;font-size:20px;">Hi Coworking</h1></div>`;
    const footer = `<div style="padding:16px 32px;font-size:12px;color:#94a3b8;">You received this because you're part of the Hi Coworking community.<br/><a href="${url}" style="color:#6366f1;">View event</a></div>`;
    let body = "";
    switch (jobType) {
        case "announce":
            body = `<p>Hey ${name},</p><p>We're excited to announce <strong>${title}</strong>${date ? ` on ${date}` : ""}${location ? ` at ${location}` : ""}.</p><p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#0f172a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Register Now</a></p>`;
            break;
        case "reminder":
            body = `<p>Hey ${name},</p><p>Just a reminder that <strong>${title}</strong> is coming up${date ? ` on ${date}` : ""}.</p><p>Don't forget to mark your calendar!</p><p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#0f172a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">View Details</a></p>`;
            break;
        case "starting_soon":
            body = `<p>Hey ${name},</p><p><strong>${title}</strong> is starting soon! Make sure you're ready.</p><p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#0f172a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Join Now</a></p>`;
            break;
        case "follow_up":
            body = `<p>Hey ${name},</p><p>Thanks for being part of <strong>${title}</strong>! We hope you enjoyed it.</p><p>We'd love to hear your feedback.</p>`;
            break;
        default:
            body = `<p>Hey ${name},</p><p>Check out <strong>${title}</strong>.</p>`;
    }
    return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">${header}<div style="padding:24px 32px;">${body}</div>${footer}</div>`;
}
function renderSmsBody(jobType, ctx) {
    const title = ctx.eventTitle || "our event";
    const url = ctx.eventUrl || "https://hi-coworking.com/events";
    switch (jobType) {
        case "announce":
            return ctx.copyVariants?.smsAnnounce || `Hi Coworking: You're invited to ${title}! Register at ${url}`;
        case "reminder":
            return ctx.copyVariants?.smsReminder || `Hi Coworking: Reminder — ${title} is coming up soon. Details: ${url}`;
        case "starting_soon":
            return `Hi Coworking: ${title} is starting soon! ${url}`;
        case "follow_up":
            return ctx.copyVariants?.smsFollowUp || `Hi Coworking: Thanks for attending ${title}! We'd love your feedback.`;
        default:
            return `Hi Coworking: ${title} — ${url}`;
    }
}
function renderPushTitle(jobType, ctx) {
    return renderEmailSubject(jobType, ctx);
}
function renderPushBody(jobType, ctx) {
    const title = ctx.eventTitle || "our event";
    switch (jobType) {
        case "announce":
            return `You're invited to ${title}. Tap to register.`;
        case "reminder":
            return `${title} is coming up soon!`;
        case "starting_soon":
            return `${title} starts now — tap to join.`;
        case "follow_up":
            return `Thanks for attending ${title}!`;
        default:
            return `Check out ${title}`;
    }
}
