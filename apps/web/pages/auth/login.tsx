/* eslint-disable @typescript-eslint/no-explicit-any */

export default function Login(props: any) {
  return <pre>{JSON.stringify(props, null, "  ")}</pre>;
}

let hot = false;

// TODO: Once we understand how to retrieve prop types automatically from getServerSideProps, remove this temporary variable
export const getServerSideProps = async function getServerSideProps(): Promise<any> {
  const wasHot = hot;
  hot = true;
  const times = [Date.now()];
  await import("@calcom/prisma");
  times.push(Date.now());
  await import("classnames");
  times.push(Date.now());
  await import("jose");
  times.push(Date.now());
  await import("next");
  times.push(Date.now());
  await import("next-auth/react");
  times.push(Date.now());
  await import("next/link");
  times.push(Date.now());
  await import("next/router");
  times.push(Date.now());
  await import("react");
  times.push(Date.now());
  await import("react-hook-form");
  times.push(Date.now());
  await import("react-icons/fa");
  times.push(Date.now());

  await import("@calcom/features/auth/SAMLLogin");
  times.push(Date.now());
  await import("@calcom/features/auth/lib/ErrorCode");
  times.push(Date.now());
  await import("@calcom/features/auth/lib/getServerSession");
  times.push(Date.now());
  await import("@calcom/features/ee/sso/lib/saml");
  times.push(Date.now());
  await import("@calcom/lib/constants");
  times.push(Date.now());
  await import("@calcom/lib/getSafeRedirectUrl");
  times.push(Date.now());
  await import("@calcom/lib/hooks/useLocale");
  times.push(Date.now());
  await import("@calcom/lib/telemetry");
  times.push(Date.now());
  await import("@calcom/ui");
  times.push(Date.now());
  await import("@calcom/ui/components/icon");
  times.push(Date.now());

  await import("@lib/types/inferSSRProps");
  times.push(Date.now());
  await import("@lib/withNonce");
  times.push(Date.now());
  await import("@lib/withNonce");
  times.push(Date.now());

  await import("@components/AddToHomescreen");
  times.push(Date.now());
  await import("@components/auth/TwoFactor");
  times.push(Date.now());
  await import("@components/ui/AuthContainer");
  times.push(Date.now());

  await import("@server/lib/constants");
  times.push(Date.now());
  await import("@server/lib/ssr");
  times.push(Date.now());
  const props = {
    times: times.map((time, index) => {
      if (index === 0) {
        return 0;
      }
      return time - times[index - 1];
    }),
    hot: wasHot,
  };
  console.error("timing", props);
  return {
    props,
  };
};

Login.isThemeSupported = false;
