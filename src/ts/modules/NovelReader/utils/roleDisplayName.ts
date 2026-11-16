/** 阅读界面隐藏无名角色的身份编号，内部角色键保持不变。 */
export function roleDisplayName(role?: string): string {
  const name = String(role || '').trim();
  if (!/^未命名[_＿]/.test(name)) {
    return name || '未知角色';
  }
  return name.replace(/^未命名[_＿]/, '').split(/[_＿]/)
    .filter(part => part && !/^\d+$/.test(part))
    .join(' ') || '无名角色';
}
