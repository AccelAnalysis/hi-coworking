This is the Next.js web application for Hi-Coworking and the Hi-Coworking Exchange.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

The Week 1 Exchange launch path is:

1. `/register` or `/login`
2. `/exchange/onboarding` to search, claim, or create an organization
3. `/exchange/membership?organizationId=...` to compare Free and Founding Membership
4. Stripe test Checkout and the `/exchange/membership/success` or `canceled` return routes

Copy the public Firebase values from the repository `.env.example` into `apps/web/.env.local`. Stripe secrets and the Founding price are Cloud Functions configuration and must never use `NEXT_PUBLIC_` variables. See `docs/stripe-test-setup.md` and `docs/isle-of-wight-seed-import.md`.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
