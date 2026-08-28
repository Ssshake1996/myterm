export const MAX_ENVIRONMENT_GROUP_CHARS = 80;

const WINDOWS_ILLEGAL_CHARACTERS = /[<>:"/\\|?*]/u;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export function environmentGroupError(value: string): string | null {
  if (!value) return "环境分组名称不能为空";
  if (value.trim() !== value) return "环境分组名称不能以空白字符开头或结尾";
  if ([...value].length > MAX_ENVIRONMENT_GROUP_CHARS) {
    return `环境分组名称不能超过 ${MAX_ENVIRONMENT_GROUP_CHARS} 个字符`;
  }
  const illegal = [...value].find((character) => {
    const code = character.codePointAt(0) ?? 0;
    return WINDOWS_ILLEGAL_CHARACTERS.test(character) || code <= 0x1f || code === 0x7f;
  });
  if (illegal) return `环境分组名称包含非法字符：${illegal}`;
  if (value.endsWith(".")) return "环境分组名称不能以句点结尾";
  if (WINDOWS_RESERVED_NAME.test(value)) return `环境分组名称不能使用 Windows 保留名称：${value}`;
  return null;
}
