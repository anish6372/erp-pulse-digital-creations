import PublicBridge from '../../../components/PublicBridge';

export default async function Page({ params }) {
  const { token } = await params;
  return <PublicBridge kind="review" token={token} />;
}
