const HIGH_SURROGATES = { first: 0xd800, last: 0xdbff } as const;

const endsInHighSurrogate = (text: string): boolean => {
  const last = text.charCodeAt(text.length - 1);
  return last >= HIGH_SURROGATES.first && last <= HIGH_SURROGATES.last;
};

export const excerptOf = (text: string, limit: number): string => {
  const cut = text.slice(0, limit);
  const splitsPair = cut.length < text.length && endsInHighSurrogate(cut);
  return splitsPair ? cut.slice(0, -1) : cut;
};
