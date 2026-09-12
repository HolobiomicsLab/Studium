/** The extension build embeds the shared stylesheet through esbuild's text loader. */
declare module '*.css' {
  const value: string;
  export default value;
}
