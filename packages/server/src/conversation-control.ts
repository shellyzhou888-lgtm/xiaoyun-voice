/** Only whole, explicit dismissal commands qualify; questions/quotes/negations stay with the model. */
export function isDismissalCommand(text:string){
  const command=text.replace(/[\s，,。.!！、]/gu,'');
  return /^(?:嗯|哦|好(?:的|了)?|那就?|谢谢|小云|没(?:有)?(?:事|事情)了?)*(?:(?:你)?(?:现在)?(?:可以|先)?(?:退下|回去)(?:吧|了|啦)?|结束(?:这次)?对话|没(?:有)?(?:事|事情)了|不说了|再见|拜拜)$/.test(command);
}
