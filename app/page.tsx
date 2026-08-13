import Link from "next/link";

export default function HomePage() {
  return (
    <main className="shell">
      <p className="eyebrow">VALORANT STORE CHECKER</p>
      <h1>Your collection watch starts here.</h1>
      <p className="lede">
        The catalog, account access, and personal watchlist are being assembled in separate,
        testable layers.
      </p>
      <Link className="primary-link" href="/sign-in">
        Sign in with email
      </Link>
    </main>
  );
}
