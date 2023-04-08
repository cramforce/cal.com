/* eslint-disable @typescript-eslint/no-explicit-any */

export default function Login() {
  return <h1>hello world</h1>;
}

// TODO: Once we understand how to retrieve prop types automatically from getServerSideProps, remove this temporary variable
export const getServerSideProps = async function getServerSideProps(): Promise<any> {
  return {
    props: {},
  };
};

Login.isThemeSupported = false;
