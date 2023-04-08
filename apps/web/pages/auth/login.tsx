/* eslint-disable @typescript-eslint/no-explicit-any */

export default function Login(props: any) {
  return <pre>{JSON.stringify(props, null, "  ")}</pre>;
}

let hot = false;

// TODO: Once we understand how to retrieve prop types automatically from getServerSideProps, remove this temporary variable
export const getServerSideProps = async function getServerSideProps(): Promise<any> {
  const wasHot = hot;
  hot = true;
  const before = Date.now();
  await import("@calcom/prisma");
  return {
    props: {
      after: Date.now() - before,
      hot: wasHot,
    },
  };
};

Login.isThemeSupported = false;
