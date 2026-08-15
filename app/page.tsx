import Link from "next/link";

export default function HomePage() {
  return (
    <main className="shell">
      <p className="eyebrow">VALORANT STORE CHECKER</p>
      <h1>Never miss the skin you actually want.</h1>
      <p className="lede">
        Pick the skins worth watching. Once a day, just after the store rotates,
        VAL Checker looks at your storefront and emails you only when something
        on your list is actually there.
      </p>
      <Link className="primary-link" href="/sign-in">
        Sign in with email
      </Link>
    </main>
  );
}
