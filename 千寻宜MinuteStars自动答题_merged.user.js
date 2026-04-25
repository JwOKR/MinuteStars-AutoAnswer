// ==UserScript==
// @name         千寻宜 MinuteStars 自动答题器 Pro
// @namespace    https://pcs.minutestars.com/
// @version      4.4.6
// @author       JIA
// @description  MinuteStars专用：内置300+题库 + GM持久化 + 模糊匹配(面板可调) + 规则推断 + 答案采集 + Word文档一键导入(.docx) + 面板设置区
// @match        https://pcs.minutestars.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* =========================================================
     全局常量
  ========================================================= */
  const CFG_KEY = 'qxy_cfg_v4';
  const SCRIPT_VERSION = GM_info.script.version;

  /* =========================================================
     配置区（GM 持久化，面板可实时修改）
  ========================================================= */

  /** 默认配置 */
  const CFG_DEFAULT = {
    username:    '',
    password:    '',
    autoLogin:   false,
    autoAnswer:  false,
    autoSubmit:  false,
    submitDelayMin: 40,
    submitDelayMax: 120,
    answerDelay: 120,
    fuzzyEnable: true,
    fuzzyThresh: 0.75,
    debug:       false,
  };

  /** 运行时配置（从 GM storage 恢复） */
  const CFG = (() => {
    try {
      const saved = JSON.parse(GM_getValue(CFG_KEY, '{}'));
      return Object.assign({}, CFG_DEFAULT, saved);
    } catch { return { ...CFG_DEFAULT }; }
  })();

  /** 持久化保存 CFG */
  function saveCFG() {
    try { GM_setValue(CFG_KEY, JSON.stringify(CFG)); } catch {}
  }

  /* =========================================================
     内置题库（固定，不可删除）
  ========================================================= */
  const BUILTIN_DB = {
    "1.（）是指─段时间的技能学习，主要针对新人或者新业务。":"B",
"2.（）主要是联络感情，面对面做一对一会议等。":"C",
"3.出差人凭核准的（）可向财务部暂支相当数额的旅差费，原则是前账不清，后账不借。":"A",
"4.出差住宿报销标准：各省会、直辖市、全国大中城市、经济较发达地区，（）元以内/天，凭相应住宿发票报销。":"C",
"5.出差住宿报销标准：中小城市及县级乡镇地区（）元以内/天，凭相应住宿发票报销。":"B",
"6.西安、深圳内部出差补助为__/天？":"A",
"7.西安与深圳集团内部出差分为哪两种情况（）":"A,B",
"8.出差到外地三日内（含三日）的普通职员、及部门主管以上人员出差的，出差申请分别由（）核准，并报备财务行政部。":"A,B,C",
"9.公司出差人员按规定乘坐火车、飞机长途汽车，凭相应票据报销；乘坐交通工具的时间一律安排在（），不要占用太多工作时间。":"A,C",
"10.报销单应填写规范，报销时报销单上应注明所办每一单的（）和原始单据张数，并附原始单据和发票，经部门主管审核签字后，交财务部审核签字，再交彭总审批。":"A,B,C,D",
"11.以下哪项费用不得报销？":"A,B,C,D",
"12.西安、深圳内部例行工作出差一般为___到___天。":"B,C",
"13.出差的时长是由什么决定？":"A,B,C",
"14.所有出差当事人应提前在后台填写出差申请，写明出差事由、人数、地点、天数，填好后走审批流程。":"A",
"15.出差交通工具，都需提前一周到两周订票，充分利用时间点节省费用。":"A",
"16.出差补助（含餐费及市内交通费）按地区划分为三类。一类地区，指各省会、直辖市、等，200元/天":"A",
"17.出差补助（含餐费及市内交通费）按地区划分为三类。二类地区，指全国大中城市、经济较发达地区，160元/天。":"A",
"18.出差补助（含餐费及市内交通费）按地区划分为三类。三类地区，指中小城市及县级乡镇地区，120元/天。":"A",
"19.公关费、招待应酬等费用经彭总审批执行的，可实报实销，涉及接待费，应在费用报告中注明被执行的个人及接待目的。 ":"A",
"20.培训出差补助标准为50元/天（含休息日）对吗？":"A",
"21.出差乘坐工具的时间一律安排在上班时间，不要占用太多的休息时间。":"B",
"22.出差补助按地区分为三大类。":"A",
"23.培训出差有相应的出差补助":"A",
"1.住房补贴基本标准是（）一个月（陈美娟）":"C",
"2.婚假假期为_天(陈美娟）":"A",
"3.连续请假几天以上，须根据工作需要确定职务代理人，依审批权限审批。（陈美娟）":"A",
"4.事假每天扣除住房补贴百分之多少？当月扣除到0截止，不累计，不顺延。（潘丁发）":"D",
"5.公司处分规定严重警告存续期为几个月？（潘丁发）":"B",
"6.春节休假合计不得超过（）天（潘丁发）":"A",
"7.春节休假最早可提前几天离开？（潘丁发）":"A",
"8.连续旷工__或者全年累计旷工__者除名开除处理？（潘丁发）":"A",
"9.员工离职后几年内，保证不在本公司以外的任何场所使用本公司的商业秘密与本公司竞争？（潘丁发）":"A",
"10.婚假假期为（潘丁发）":"A",
"11.产假假期为（潘丁发）":"A",
"12.公司月全勤奖为_元（潘丁发）":"C",
"13.公司处分规定严重警告存续期为几个月？（潘丁发）":"B",
"14.一天的事假需要提前__工作日提出申请？（潘丁发）":"A",
"15.入职多久有住房补贴？（潘丁发）":"B",
"16.千寻宜创建于什么时候？（潘丁发）":"B",
"17.一般来说，新国标插线板最长使用年限为（邢鹤翔）":"A",
"18.同事在劳动合同期满后离开公司、辞退、解聘或主动离职时，办理离职后几天内搬离宿舍，特殊情况需办理离职当天跟部门主管申请，部门主管向彭总申请后才能延长入住时间，否则不予办理任何调动手续；":"C",
"19.小A入职时间为2023年8月8日，次年最早几月份可以享受年假。":"D",
"20.宿舍管理规定:外来人员如需留宿，需提前    天向行政部申请。":"D",
"21.宿舍管理规定:上班时间，不要超过晚上   点回宿舍（除特殊情况外），不能影响到其他同事休息。":"A",
"22.在公司层面考勤的原因有：（林柯）":"A,B,C,D",
"23.公司为什么要考试？（潘丁发）":"A,C",
"24.公司处分有哪几种？（潘丁发）":"A,B,C,D,E,F",
"25.给工作接收者留言可以有以下几种方法（潘丁发）":"A,B,C,D",
"26.宿舍安全问题需要注意哪些方面？":"A,B,C",
"27.住宿舍的人员需要注意哪些卫生？":"A,B,C,D",
"28.为什么剥了壳的鸡蛋微波炉加热，也会炸和带来的后果。":"A,B,C",
"29.什么东西不能放进微波炉里加热。":"A,B,C,D",
"30.累计工作满1年不满10年的员工，请病假/事假累计2个月以上的，累计工作满10年不满20年的员工，请病假/事假累计3个月以上的，累计工作满20年以上的职工，请病假/事假累计4个月以上的，当年无年休假.凡当年已享受产假或准备休产假的，当年不再享有年休假。":"A",
"31.内部沟通使用公司消息系统，外部沟通使用电子邮件系统":"A",
"32.为了保持舒适的办公环境，在公司办公区域内禁止食用榴莲、螺蛳粉等气味较重的食物（潘丁发）":"A",
"33.出差人员乘坐交通工具的出行时间一律定在早上或者晚上，尽量不占用工作时间，并保持电话畅通（潘丁发）":"A",
"34.为合理区分工作与生活，公司规定：各部门群在22：00后、公司群在23:10后实行禁言制度（潘丁发）":"A",
"35.报销费用需规范填写费用报销单，经主管领导审核无误并签字后交财务部（潘丁发）":"A",
"36.加班需提前向主管领导申请并说明情况，同意加班后，加班才予认可(潘丁发）":"A",
"37.警告期间，不享受全勤，住房补贴（张苏婷）":"A",
"38.入职超过两年，享受超额补贴部分，计算方法为（入职年限-1）*50 元，例如入职时间3年3个月，计算公式为（3-1）*50=100（张苏婷）":"A",
"39.无故不请假情况下缺勤不上班视为旷工处理（张苏婷）":"A",
"40.记过的存续期为半年，半年内进行累积，累计3次劝退（潘丁发）":"A",
"41.享有带薪年假的同事，当年没休完的天数，可以报给部门主管计算加班（潘丁发）":"A",
"42.病假一天以上须附上医院证明，并提供给行政部备案（张苏婷）":"A",
"43.旷工一天按照记大过处理（张苏婷）":"A",
"44.年度全勤津贴于5,6月份发放（潘丁发）":"A",
"45.新入职同事转正申请，无需提交纸质书面申请，以电子邮件形式提交申请即可（潘丁发）":"A",
"46.劝退作主动离职处理，可以开离职证明。离职证明中不体现劝退及考评处分。（潘丁发）":"A",
"47.月全勤为600元，随每个月的工资发放。（潘丁发）":"B",
"48.入职时间超过两年，享受超额住房补贴部分计算公式为(入职年限-1）*50元（潘丁发）":"A",
"49.无故不请假缺勤不上班，按照旷工处理。（潘丁发）":"A",
"50.原则上加班必须是由主管提出后方可加班。（潘丁发）":"A",
"51.请假都需提前向主管领导申请审批（潘丁发）":"A",
"52.转正后开始享受住房补贴（潘丁发）":"A",
"53.事假为无薪假（潘丁发）":"A",
"54.严重警告期间，不享受全勤，住房补贴。（潘丁发）":"A",
"55.每月累计迟到早退累计达30分钟或者3次，公司公开批评处理（潘丁发）":"A",
"56.休假包括但是不限于事假、病假等情况（潘丁发）":"A",
"57.原则上轮休、换休制度适用于客服部、仓储部和发货部，其他部门如有需要提前报请财务行政部申请审批（潘丁发）":"A",
"58.一天事假可以当天提出申请（潘丁发）":"B",
"59.连续旷工3天或全年累计旷工7天者给予除名开除处理。（潘丁发）":"A",
"60.旷工一天按照记大过处理（潘丁发）":"A",
"61.每月累计迟到早退累计达一个小时以上或者5次者，作严重警告处理（潘丁发）":"A",
"62.主动要求加班必须主管同意，并明确工作细则后方可加班，否则不予认可（潘丁发）":"A",
"63.当日工作未完成而延迟下班的视为加班（潘丁发）":"B",
"64.上班晚到5分钟以上为迟到行为；提前10分钟下班为早退行为（潘丁发）":"A",
"65.请假须优先使用存假（潘丁发）":"A",
"66.每年过年期间，公司为了照顾大家探亲回老家过个愉快的新年，可能有的同事休假的时间稍微长，多休的天数可以用存假或者年假来抵减，这种情况不扣全勤。（潘丁发）":"A",
"67.入职半年内的新人原则上不允许单独加班、补班。":"A",
"68.上班期间因工作需要外出的，报部门主管审批，并在公司群报备，视为正常出勤。":"A",
"69.厨房电器使用完毕后需要及时拔掉电源（邢鹤翔）？":"A",
"70.会议室使用完毕后需关闭电源、空调、桌椅归位？（邢鹤翔）":"A",
"71.用餐完毕后应及时清理桌面杂物，桌椅归位？（邢鹤翔）":"A",
"72.每日下班前需检查清理自己桌面杂物，及相邻无人空位杂物，做到整洁有序？（邢鹤翔）":"A",
"73.凡当年已享受产假的，当年不再享有年休假。":"A",
"74.根据公司内部管理要求，正常情况下请假不超过7天（包含周末），特殊情况下休假超过7天需找部门领导特批。超过7天假期的部分，不能用存假和年假抵扣，一律按请假处理。":"A",
"75.连续休假一整月的同事，当月没有应休天数。连续休假半个月的同事，当月只有1/2应休天数。":"A",
"76.住宿舍的人员未经他人允许，请勿乱动、乱翻、乱拿别人的东西。":"A",
"77.分配好宿舍的房间、床位不得私下调换，如有特殊情况需调换，要与行政部商议，共同解决。":"A",
"78.住宿舍的人员自觉保持宿舍安静，不得大声喧哗，晚上 11 点后停止一切娱乐活动 （包括游戏），以免打扰到别人。并检查未归宿人员。":"A",
"79.住宿舍的同事之间和睦相处，禁止拉帮结派、挑衅、起哄闹事。不得以任何借 口争吵、打架、酗酒，有意见当面说，或者反馈到行政部。凡发生打架斗殴事件，情节严重的则送交公安机关处理，公司给予警告或除名处理。":"A",
"80.住宿舍的人员晚上 11 点后没有急事不要打电话，改发短信（手机记得调成静音），以免影响别人睡觉。":"A",
"81.持有宿舍钥匙的同事，不得将钥匙转借非本宿舍人员使用，否则发生宿舍失窃事件，要追其责任。":"A",
"82.住宿舍的人员，贵重物品自行妥善保管好。":"A",
"83.住宿舍的人员请保持门厅、走廊及楼梯畅通，不能乱堆、乱放物品。保持室内通风。":"A",
"84.宿舍内须谨慎吸烟。在房内吸烟而烧坏物品或引起火灾，将追究其经济责任，触犯刑律的，则追究其刑事责任。":"A",
"85.宿舍内不准乱拉电线与插座，不准使用高压电器等危险电器。":"A",
"1.10分钟以内的事情，以追加备注的形式录入今日杂事集合。":"A",
"2.若当天任务未完成，该如何操作？（吴琪达）":"C",
"3.计时器页面-工作内容-更多操作中点击任务推迟后，会____ ?(彭凯)":"C",
"4.给表格表头画一条斜线可以在“设置单元格格式”里的哪个选项卡下面操作？（李茂华）":"C",
"5.曲线的右上端代表什么？（王淋）":"A",
"6.曲线的快捷键是？（王淋）":"A",
"7.函数名称输入错误会显示什么错误？（李茂华）":"A",
"8.用户一般在哪个生命周期会创造更好的利润价值？（钟培峰）":"C",
"9.同款商品分别发布多个链接属于哪种信息违规？（李茂华）":"B",
"10.准时生产制简称？（李茂华）":"B",
"11.返回字符所在位置的函数是？（李茂华）":"A",
"12.被称为电商ERP系统中的高富帅是哪一个？（彭俊）":"A",
"13.返回A1单元格的快捷键是？（李茂华）":"B",
"14.在Excel里面,按快捷键F1会出现？（李茂华）":"A",
"15.公司内购，衣服能打几折卖给员工？（彭俊）":"C",
"16.插入数据透视表的快捷键是？（李茂华）":"B",
"17.Excel的智能填充快捷键是？（钟林梅）":"A",
"18.判断是否为数值的函数是？（李茂华）":"C",
"19.点击拆分窗口后，可以拆分出几个？（李茂华）":"D",
"20.新建一个主题系列后，名称是不能修改，我们还可以在哪里修改备注？（彭俊）":"B",
"21.定位空值填充第一步应该做什么？（李茂华）":"C",
"22.定位空值填充第一步应该做什么？（李茂华）":"C",
"23.卖点有几个比较合适？（李茂华）":"B",
"24.在Excel表中，“VLOOKUP”函数是什么？（彭俊）":"B",
"25.用bat批量修改文件名的代码是？":"A",
"26.我想把文件“小明”移动到“小红”文件夹，下面哪个bat代码的写法是正确的？":"A",
"27.用bat批量移动文件到文件夹的代码是？":"B",
"28.钻石展位按照什么顺序进行展现？（罗思玮）":"B",
"29.行不锁定列锁定，拖动单元格会怎么变化？（李茂华）":"C",
"30.条件判断函数if在excel中的意思是？（李茂华）":"B",
"31.数据透视表作用是什么？（彭俊）":"B",
"32.产品到达哪一个生命周期可以在京东平台上架？":"C",
"33.简单求和的语法是？（李茂华）":"A",
"34.移动折线图数据标签位置时选？（李茂华）":"A",
"35.SPU是什么？（彭俊）":"B",
"36.唯品会平台，“1个色3个尺码”，可以怎么描述？（彭俊）":"D",
"37.遇到差评怎么处理是正确的？":"C",
"38.唯品会的JIT模式是什么？（李茂华）":"A",
"39.可以直接拿来发货的库存区域是哪个区域？（钟林梅）":"A",
"40.利润款产品类型占比应该是多少？（李茂华）":"C",
"41.加大推广投入主要看？（李茂华）":"A",
"42.CPA是什么？（李茂华）":"B",
"43.CPT是什么？（李茂华）":"B",
"44.一般用多长时间统计的数据作为原始分析数据？（彭俊）":"B",
"45.打造爆款最主要是为了什么？(汪舒蕾)":"C",
"46.在《无线端爆款新玩法》一课中，提到质量分飙升方法的第一步，需要添加几个核心词？(汪舒蕾)":"A",
"47.CPS是什么？（李茂华）":"A",
"48.CPC是什么？（李茂华）":"C",
"49.CPM是什么？（李茂华）":"B",
"50.以下哪种人群不属于“iphone手机壳 水钻”人群（彭俊）":"C",
"51.爆款详情页一定要有一个（）？（汪舒蕾）":"A",
"52.关键词拓展一定要通过哪几种词拓展（李茂华）":"A",
"53.假如你作为消费者保障服务卖家，退款率过高将被强制退出消费者保障服务。（罗思玮）":"B",
"54.以下选项中哪一项不属于店铺会员生命周期？（李茂华）":"E",
"55.下列哪项是单品核心数据？（李茂华）":"B",
"56.手Q端和M端流量是指什么？（李茂华）":"B",
"57.什么样的款可以被称为爆款？（王淋）":"A",
"58.动销率是什么？（钟培峰）":"C",
"59.UV价值是什么？（李茂华）":"D",
"60.店铺销售额的计算公式是？（彭俊）":"A",
"61.销售转化率的计算公式是？（彭俊）":"D",
"62.一个客户的负面的评价，会引起所有购买客户的负面评价，这种现象一般称之为？（彭俊）":"D",
"63.市场同质化越来越严重，价格战愈演愈烈，唯有什么是唯一出路？（彭俊）":"B",
"64.“商对客”是电子商务的一种模式，以下哪种简称是商对客的商业模式":"C",
"65.以下哪个词不属于广告法极限词":"D",
"66.互联网法规中，3.15介入的消协是什么部门":"D",
"67.根据《广告法》第五十五条　违反本法规定，发布虚假广告，两年内有三次以上违法行为或者有其他严重情节的，给予的处罚是?":"A",
"68.以下不属于信息违规的是?":"A",
"69.商品售罄率，如何计算？":"A",
"70.产品卖点特点采用FABE利益销售法，其中A是指?":"C",
"71.产品测图过程中，最核心最重要的指标是?":"B",
"72.标题关键词优化过程中，宝贝热点词一般不超过几个?":"C",
"73.关键词竞争力的判断怎么确定哪个关键词竞争大小？":"A",
"74.热卖商品出现差评时，最佳处理方法是?":"D",
"75.在标题拆分关键词时，顺序应该是?":"A",
"76.标题优化最佳频率是?":"D",
"77.互联网数据中UV数据是指?":"B",
"78.互联网数据中PV数据是指?":"A",
"79.双十一购物狂欢节，除淘宝平台之外在活动氛围装修中使用以下哪种表述会涉嫌侵权?":"B",
"80.商品复购率是指?":"C",
"81.下列哪项不是卖家必须做的?":"C",
"82.客户在下单后发现拍错颜色尺码，客户跟客服交流时应该怎么处理?":"D",
"83.商城店铺，客户要求改价才付款，客服问你应该如何处理?":"B",
"84.在跟平台小二沟通过程中，小二做错了，影响到品牌的资源，你该怎么做?":"D",
"85.“用户画像”是指?":"C",
"86.带 ®的商标是指?":"A",
"87.平行门槛试算：顾客A在店铺购买了1件299元的连衣裙+1件159元的衬衫+1件大衣599元，当时店铺活动为2件7.5折，优惠券每满400-20，最终客户实付金额为?":"B",
"88.以下不属于平台通用促销优惠的是?":"D",
"89.以下哪项不属于“私域流量”":"A",
"90.做会员营销首先第一步应该是?":"B",
"91.客服考核指标中的询单转化率是指?":"A",
"92.以下哪项是衡量页面内容是否吸引客户的关键数据?":"C",
"93.市场同质化越来越严重，价格战愈演愈烈，唯有什么是唯一出路？（彭俊）":"B",
"94.突出产品卖点的时候，显性卖点要（），隐形卖点要（）":"A",
"95.深挖卖点时，不包括人怎么来的选项是？":"D",
"96.动销率正确的公式是哪个？":"B",
"97.关键词的竞争度公式是？":"C",
"98.以下选项，哪一项和产品标题优化没有相关性？":"C",
"99.标题多长时间优化一次更合适？":"B",
"100.一次性优化标题，建议最多不要超过几个字？":"A",
"101.淘宝主搜一个页面最多展示同一店铺几款宝贝？":"B",
"102.A款前一天无官方活动，其中店内UV1000，成交客户数5；搜索UV500，成交客户数10，A款的支付转化率和搜索支付转化率分别是多少？":"A",
"103.设置店铺VIP1门槛时，交易额金额和次数设置多少比较合理？":"A",
"104.促进销售的手段哪个是错误的":"D",
"105.下列不属于细分市场定位的分析是？":"B",
"106.下列不属于选择关键词误区的选项是？":"C",
"107.小A入职时间为2023年8月8日，次年最早几月份可以享受年假":"D",
"108.抖音库存同步队列，同步库存失败后，手动改库存后，还需要重新同步库存吗？":"B",
"109.最早提出ERP概念的咨询公司在？":"A",
"110.在Excel表中，“MID”函数是什么？":"D",
"111.库存深度是什么意思？":"A",
"112.年度全勤津贴于次年几月发放完成？":"B",
"113.工作满1年的同事，可享受7天带薪年假，年假未休完的，按加班算或留存下一年休":"A",
"114.早上上班到位，群里扣1是在什么时间，什么地点：":"A",
"115.晚上加班计算：":"B",
"116.日常出勤必做清单":"A,B,C,D,E,F,G,H",
"117.工作日到达公司在运营群发消息记录是为了（彭凯）":"A,B,C,D",
"118.当日或之前已完成的工作任务可以在计时器页面中哪里查找（吴琪达）":"C,D",
"119.ERP是什么？":"A,B",
"120.计时器的任务类型有？（吴琪达）":"A,B,C,D,E",
"121.关于计时器管理，哪些是正确的？（唐甲娟）":"A,B,C,D",
"122.日常工作沟通的要点有哪些？（李茂华）":"A,B,C,D",
"123.想要将带斜线的表头里的文字调整到合适的位置，可以用哪两种方法？（李茂华）":"A,B",
"124.常见的函数错误有哪些？（李茂华）":"A,B,C,D,E",
"125.淘宝直播有哪些优势？（李茂华）":"A,B,C,D",
"126.用户的生命周期分为哪几种？（钟培峰）":"A,B,C,D",
"127.如何让顾客愿意点击你的主图？（罗思玮）":"A,B,C,D",
"128.商品主图构图尽可能突出产品，常见的构图有哪些？（罗思玮）":"A,B,C,D,E",
"129.如何通过主图去提高转化率？（罗思玮）":"A,B,C,D,E",
"130.信息重复包括以下哪些选项？（李茂华）":"A,B,C",
"131.以下说法正确的有？":"A,B",
"132.雪纺面料服装的特点有哪些？（彭俊）":"A,B,C,D",
"133.供应链结构包括？":"A,B,C,D,E",
"134.find的三个参数是？（李茂华）":"A,B,C",
"135.十大电商ERP系统有哪些？（彭俊）":"A,B,C,D,E,F,G,H,I,J",
"136.属于excel快捷键的有？（李茂华）":"A,B,C,D",
"137.在人物图裁剪过程中，避免在身体的各个关节处进行裁剪，包括一下那些？（彭俊）":"A,B,C,D,E,F,G",
"138.表格智能填充快捷键哪两个版本可用？（钟林梅）":"A,B",
"139.直通车是什么？（罗思玮）":"A,B",
"140.常见的构图方法有哪些？（彭俊）":"A,B,C,D,E,F,G,H",
"141.IS函数判断有哪些？（李茂华）":"A,B,C,D,E,F,G",
"142.属于排序依据选项的有？（李茂华）":"A,B,C,D",
"143.正常情况下，主题系列中只有哪些生命周期的产品缩略图上才会有“禁”（禁止补货）字标（彭俊）":"B,C",
"144.EXCEL表中怎么操作定位对话框？（李茂华）":"A,B,C",
"145.EXCEL表中怎么操作定位对话框？（李茂华）":"A,B,C",
"146.视频中详情图优化要注意的要点？（李茂华）":"A,B,C,D,E,F",
"147.在Excel表中，“VLOOKUP”函数有哪两种匹配方式？（彭俊）":"B,C",
"148.函数输入方式有哪几种？（李茂华）":"A,B,C",
"149.属于if参数的有？（李茂华）":"A,B,C",
"150.用excel做数据透视表需注意什么？（彭俊）":"A,B,C,D",
"151.以下属于信息违规的是？":"A,B,D",
"152.合理的产品类型结构有哪几个？":"A,B,C,D,E",
"153.Sumif（条件求和）有哪几个参数？（李茂华）":"A,B,C",
"154.图表样式包括？（李茂华）":"A,B,C,D,E,F",
"155.公司产品的生命周期有哪些？（彭俊）":"A,B,C,D,E",
"156.店铺可以从哪几个方面提升单品的静默转化？":"A,B,C,D,E",
"157.京东平台库存同步是同步哪几个货区库存？":"A,B",
"158.描述唯品会JIT模式的三退是哪三退?（李茂华）":"A,B,C",
"159.生意参谋里流量的主要来源有哪些？（罗思玮）":"A,B,C,D,E",
"160.以下哪些方式可以增加客人的购买欲？（钟林梅）":"A,B,C,D",
"161.以下关于标品说法正确的是？（娟姐）":"A,B,C,D",
"162.以下属于标品的是？（娟姐）":"A,B,C",
"163.以下关于非标品说法正确的是？（娟姐）":"A,B,C,D",
"164.以下属于非标品的有？（娟姐）":"B,C,D",
"165.产品矩阵四要素包括哪些？（李茂华）":"A,B,C,D",
"166.一个款要增加它的转化率，需要哪些办法？（钟林梅）":"A,B,C,D",
"167.下列哪些能提升宝贝转化率？（钟林梅）":"A,B,C,D",
"168.下列属于推广工具的是？（李茂华）":"A,B,C,D,E,F",
"169.以下哪些是属于较好的单品数据？（彭俊）":"A,B,C",
"170.在《无线端爆款新玩法》一课中，提到的爆款打造流程包括哪几步？(汪舒蕾)":"A,B,C,D",
"171.如何提升宝贝转化率获取最大流量？（李茂华）":"A,B,C,D",
"172.“iphone手机壳 水钻”人群画像定位是？（彭俊）":"A,B,C,D",
"173.销售一款羊毛衫，以下哪几项可以做为核心卖点？（汪舒蕾）":"A,B,C",
"174.做好一个标题需要？（李茂华）":"A,B,C,D",
"175.营销活动分层有哪几种？（李茂华）":"A,B,C",
"176.详情页数据分析需要分析哪些数据？（李茂华）":"A,B,C,D",
"177.流量下降的原因包括哪些？（汪舒蕾）":"A,B,C,D,E",
"178.流量的结构组成包括哪几项（汪舒蕾）":"A,B,C,D",
"179.对接运营的简称称呼正确的有？（钟培峰）":"A,B,C",
"180.生意参谋对广告和美工有帮助的功能是哪些？（钟林梅）":"A,B",
"181.备战双十一看生意参谋里面哪些数据？（钟林梅）":"A,B,D",
"182.做到差异化，需要从那几个放心切入？（彭俊）":"A,B,C,D",
"183.生意参谋里的行业大盘能看到整个大盘走势，可以看到以下哪些数据指标？":"A,B,C,D,E,F",
"184.生意参谋里的品牌排行可以看到TOP500品牌，可以看到以下哪些数据？ ":"A,B,C,D",
"185.最常用的网页应该如何管理？":"A,B,C,D",
"186.客户投诉的三无产品，是指哪三无？":"B,C,D",
"187.计算店铺业绩的依赖哪三个关键数据？":"A,D,E",
"188.美工转运营需要具备的最重要的素质是？":"A,B,E",
"189.以下属于马斯洛定律的是？":"A,B,C,E",
"190.以下哪些方式是正确的，并有助于提升客单":"A,C,D",
"191.分析现有标题中包含的关键词是通过哪两项指标?":"A,C",
"192.组合关键词的原则正确的是?":"A,C",
"193.以下会直接影响关键词权重的有?":"B,C,D,E",
"194.如何验证标题优化的效果":"A,D",
"195.以下能够影响DSR评分的因素有?":"A,B,C,E",
"196.做到差异化，需要从那几个方向切入？（彭俊）":"A,B,C,D",
"197.对于描写晚白羊毛衫卖点，哪一种是错误的？":"C,D",
"198.深挖卖点时，针对怎么让客户掏钱我们可以做的有那些？":"A,B,C",
"199.产品要素中的市场分析与定位包含以下哪些方面？":"A,B,C",
"200.流量和产品有哪些关系？":"A,B,C",
"201.店铺动销率会通过以下哪几个方面影响店铺权重":"A,B,C,D",
"202.标题维护时应避免什么，以下错误的有哪些？":"A,C",
"203.标题SEO优化关键词策略主要有以下哪几项？":"A,B,C",
"204.产品差异化怎么做？结合价值曲线三步法哪几步来分析、确定产品差异化的方向？":"A,C,D",
"205.哪些是潜力款必须具备的条件？":"A,C,D",
"206.据数据统计，对商家而言新老客户对比，老客户哪些数据更高？":"A,B,D",
"207.商家可以从哪些方面建立自己的情感共鸣元素？":"A,C",
"208.下列哪些属于子类目分析和属性分析的方向？":"A,B,C,D,E",
"209.下列属于关键词收集渠道的选项是？":"A,B,C,D",
"210.设置促销之前为什么要同步库存？（多选）":"A,B,C,D",
"211.提升店铺粉丝数可以用到哪些方法（多选）":"A,B,C,D,E,F",
"212.下列属于私域渠道的是（多选）":"A,D",
"213.在直播中直播间氛围不理想时，场控应该怎么做？（多选）":"A,B,C,D",
"214.直播复盘的关键数据是什么呢？（多选）":"A,B,C,D,E",
"215.每天都需要转发公众号文章和短视频到自己的朋友圈（彭凯）":"A",
"216.若临时有急事先暂停当前任务，创建并开始急事的任务":"A",
"217.在ERP-个人精进计时器当中，任务开始后填写备注错误，可以删除再重新备注。（彭凯）":"B",
"218.计时器页面长时间无操作可以直接录入，无需重新登陆（吴淇达）":"B",
"219.在表头画一条斜线是可以直接在“设置单元格格式”里的“边框”完成，是吗？（李茂华）":"A",
"220.曲线既可以调明暗又可以调色彩,对吗？（王淋）":"A",
"221.查询引用错误可以在公式-错误检查-循环引用中查询对吗？（李茂华）":"A",
"222.通常在傍晚直播时，观看直播的人员相对更多，对吗？（李茂华）":"A",
"223.可以用推荐新用户而获取优惠券来吸引老客，从而引入新客吗？（钟培峰）":"A",
"224.标题含有招商是属于信息违规？（李茂华）":"A",
"225.使用高低频修图时，高频应在低频图层上方？":"A",
"226.雪纺是丝产品中的纱（不是纺）类产品，名称来自英语Chiffon的音译，意为轻薄透明的织物（彭俊）":"A",
"227.供应链三流包括信息流、物流、资金流对吗？（李茂华）":"A",
"228.大小写函数是指能快速把单元格数值/字母变成大写/小写/首字母大写（李茂华）":"A",
"229.ERP(Enterprise Resource Planning)=企业资源计划，俗称企业管理系统，我们每天打卡需要登录的后台就是ERP系统（彭俊）":"A",
"230.Sumproduct可以求区域乘积之和对吗？（李茂华）":"A",
"231.在Excel里面,按快捷键F2和双击单元格是一样的效果对吗？（李茂华）":"A",
"232.在人物图裁剪过程中，为了让观众从心理上认为被裁剪部分有继续“延伸感”，所以不能在关节处裁剪。（彭俊）":"A",
"233.在人物图裁剪过程中，人的潜意识中，习惯以关节为单位来记忆身体各部分的结构，这种脑补能会在关节处停止。（彭俊）":"A",
"234.值日打扫完卫生后，需要在微信群发出拖地干净后的图片？（彭俊）":"A",
"235.数据透视表选项里取消勾选更新时自动调整列宽的选项，筛选数据时宽度就不会改变对吗？（李茂华）":"A",
"236.数据透视表的多维布局是菜单栏的设计里面吗？（李茂华）":"A",
"237.唯品仓销售区指的是唯品已经销售出去的对吗？（钟林梅）":"A",
"238.淘宝直通车是一种展示免费，点击付费的推广工具？（罗思玮）":"A",
"239.直通车的排名规则：综合得分=出价*质量得分":"A",
"240.正常情况下，把主体放到黄金分割线或分割点上，就能得到比较好的画面感（彭俊）":"A",
"241.iferror判断是否为错误，如果正确返回计算值对吗？（李茂华）":"A",
"242.ctrl+shift+上下左右键是快速大批量的行列选取的快捷键？（李茂华）":"A",
"243.主题系列中缩略图上面的“平”字标为非唯品平台专属款标，“全”字标为全平台标款（彭俊）":"A",
"244.按快捷键F5能快速跳出定位对话框对吗？（李茂华）":"A",
"245.按快捷键F5能快速跳出定位对话框对吗？（李茂华）":"A",
"246.接到优化详情页任务后，不着急做先拿衣服摸一摸，看一看找卖点对吗？（李茂华）":"A",
"247.在Excel表“VLOOKUP”函数可以在多个表格之间快速匹配查找数据吗？（彭俊）":"A",
"248.在Excel表“VLOOKUP”函数公式中，精确查找的英文是FALSE可用数字为0代替，模糊查找的英文是TRUE可用1代替（彭俊）":"A",
"249.钻展是以图片展示为基础，精准定向为核心，面向全网精准流量实时竞价的展示推广平台。（罗思玮）":"A",
"250.钻展是按流量竞价售卖广告位，计费单位为CPM(每千次浏览单价)即广告被展现的1000次所需要收取的费用。（罗思玮）":"A",
"251.相对引用都不锁定拖动单元格行和列都会变化对吗？（李茂华）":"A",
"252.if函数有3个参数？（李茂华）":"A",
"253.修改完表格格式或者内容后，可再数据透视表的sheet里“刷新”来更新成最新的数据透视表。（彭俊）":"A",
"254.锁定选定的单元格或区域可以按F4快捷键对吗？（李茂华）":"A",
"255.插入图表之前必须先选择数据区域？（李茂华）":"A",
"256.唯品会是以颜色为单位上架，一个颜色为个货号，因此一个颜色可以称为“SPU”（彭俊）":"A",
"257.唯代购是代购平台吗？（李茂华）":"A",
"258.唯品会JITX模式是商家直接发给客户吗？（李茂华）":"A",
"259.流量的渠道来源分为推广（直通车、钻石站位、淘宝客）和活动（类目活动、平台活动）及免费流量（罗思玮）":"A",
"260.成交额=流量*转化率*客单价（罗思玮）":"A",
"261.百世外部仓拣货区的可用库存是没有被占用可以被锁库的。（钟林梅）":"A",
"262.品类矩阵需要考虑产品的淡旺季？（李茂华）":"A",
"263.客服的询单转化很重要。（钟林梅）":"A",
"264.推广能带动搜索流量对吗？（李茂华）":"A",
"265.日销卖得好的产品，不一定在活动中也卖得好（彭俊）":"A",
"266.关键词权重=销量+点击率+转化率（罗思玮）":"A",
"267.标品的特点转化高（罗思玮）":"A",
"268.用差异化来提高图片的点击率将会事半功倍对吗？（李茂华）":"A",
"269.分析人群画像，看评价晒图，分析客群打扮穿着，环境等也是关键步骤":"A",
"270.关键词广度越广越好对吗？（李茂华）":"A",
"271.退款率定义指卖家在近30天成功退款、售后笔数占近30天支付宝成交笔数的比率。（罗思玮）":"A",
"272.品质退款是指买家在退款时选择与商品品质相关的退款原因（如假冒品牌、描述不符、质量问题等）且成功退款的笔数（包含售中和售后）。（罗思玮）":"A",
"273.开发一个新客户的成本会高于维护老客户的成本对吗？（李茂华）":"A",
"274.跳失率是买家对详情页设计的数据反馈的说法对吗？（李茂华）":"A",
"275.推广流量不宜超过店铺总流量的30%，对吗？（汪舒蕾）":"A",
"276.备战双十一只看数据就好了，不用管其他。（钟林梅）":"B",
"277.一般情况下，店铺评分在4.7以上，且退款率在0.1%以下就能提报聚划算。（彭俊）":"A",
"278.除了从销量，价格，视觉来分析竞争对手的竞争力外，还可以从评价来分析。（彭俊）":"A",
"279.品牌详情里可以查看竞争对手品牌的趋势、类目构成、买家特征职业和年龄分布和热销排行。":"A",
"280.标题中为了扩展词的宽度，尽可能多的把相关的类目热词都加进标题蹭热度。":"B",
"281.公域流量是指卖家无法干预的流量，属于系统推荐呈现的商品流。":"A",
"282.标题中不包含关键词，但是属性与商品本身相符，依然可以展现。":"A",
"283.淘宝直通车，京东快车都是按照展示计费（CPM）。":"B",
"284.在商品优化过程中，要迎合用户体验，按照客户心理可以适当夸大产品功能，才能吸引客户，起到促进转化的作用。":"B",
"285.百度SEO属于站内流量。":"B",
"286.直通车钻展是唯一的付费流量渠道。":"B",
"287.店铺只要有足够的UV，业绩就一定能够稳定下去。":"B",
"288.客户付款后，要求上门提货，客服A爽快答应。":"A",
"289.10．店铺积分是由卖家承担，平台不承担。":"A",
"290.除了从销量，价格，视觉来分析竞争对手的竞争力外，还可以从评价来分析。（彭俊）":"A",
"291.突出产品卖点时，我们可以找出和竞争对手有差异性的卖点来推，对吗?":"A",
"292.免费流量和收费流量推广方式，取决于产品的利润空间和转化率":"A",
"293.动销【整体】比单品权重高":"A",
"294.淘宝（阿里）指数可以去zhi.taobao.com查询吗？":"B",
"295.通过产品差异化带来更高的价值， 并且产品差异化成本低于产品差异化带来的价值，  形成一个差异化的竞争优势。":"A",
"296.如何让你的产品脱颖而出？核心要抓住产品差异化，从根本提升品牌竞争力。":"A",
"297.选款时，选择比努力更重要，这句话对吗？":"A",
"298.价格折扣并不适合所有商家":"A",
"299.市场容量的指标是：支付指数和支付金额父类目占比":"A",
"300.当搜索热度除以在线商品数得出的倍数，倍数越大时竞争越小，倍数越小时竞争越大。":"A",
  };

  /* =========================================================
     题库管理器（GM_setValue 持久化，跨会话保存用户自定义题库）
  ========================================================= */
  const DB_KEY = 'qxy_merged_v4';

  const LibraryManager = {
    load() {
      try { return JSON.parse(GM_getValue(DB_KEY, '{}')); } catch { return {}; }
    },
    save(db) {
      try { GM_setValue(DB_KEY, JSON.stringify(db)); } catch {}
    },
    get count() { return Object.keys(this.load()).length; },

    add(question, answer) {
      const db = this.load();
      db[question] = answer;
      this.save(db);
      return db;
    },

    addBulk(text) {
      const db = this.load();
      let added = 0, skipped = 0;
      const lines = text.split('\n').map(l => l.trim()).filter(l => l);
      for (const line of lines) {
        let q = '', a = '';
        if (line.startsWith('{')) {
          try {
            const obj = JSON.parse(line);
            if (typeof obj === 'object' && !Array.isArray(obj)) {
              for (const [k, v] of Object.entries(obj)) { q = k; a = v; break; }
            }
          } catch {}
        }
        if (!q) {
          const idx1 = line.indexOf('||');
          const idx2 = line.indexOf('|');
          if (idx1 !== -1) { q = line.substring(0, idx1).trim(); a = line.substring(idx1 + 2).trim(); }
          else if (idx2 !== -1) { q = line.substring(0, idx2).trim(); a = line.substring(idx2 + 1).trim(); }
        }
        if (q && a) { db[q] = a; added++; } else skipped++;
      }
      this.save(db);
      return { added, skipped };
    },

    remove(question) {
      const db = this.load();
      delete db[question];
      this.save(db);
    },

    clear() { GM_setValue(DB_KEY, '{}'); },

    exportJSON() { return JSON.stringify(this.load(), null, 2); },
    exportTXT() { return Object.entries(this.load()).map(([q, a]) => q + '||' + a).join('\n'); }
  };

  // 合并题库（内置 + 用户自定义，用户可覆盖内置答案）
  function getMergedDB() {
    return { ...BUILTIN_DB, ...LibraryManager.load() };
  }

  /* =========================================================
     文本归一化 & 匹配
  ========================================================= */
  function cleanText(text) {
    if (!text) return '';
    return text.trim()
      .replace(/^\d+[\.\、．]\s*/, '')
      .replace(/\(\d+分?\)/g, '')
      .replace(/\s+/g, '')
      .replace(/[：:;,，。！!？?（）()""''""''【】\[\]{}《》〈〉—\-－_+=·、．\/\\|~`@#$%^&*]+/g, '')
      .toLowerCase();
  }

  /** Levenshtein 字符串相似度（0~1） */
  function strSim(a, b) {
    if (!a || !b) return 0;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) / Math.max(la, lb) > 0.45) return 0;
    const dp = Array.from({ length: la + 1 }, (_, i) => [i]);
    for (let j = 0; j <= lb; j++) dp[0][j] = j;
    for (let i = 1; i <= la; i++)
      for (let j = 1; j <= lb; j++)
        dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
          : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return 1 - dp[la][lb] / Math.max(la, lb);
  }

  /** 精确 + 模糊双重匹配，返回答案字符串或 null */
  function findMatch(qText) {
    const db = getMergedDB();
    const nq = cleanText(qText);
    for (const [k, v] of Object.entries(db)) {
      const nk = cleanText(k);
      if (nk === nq || nk.replace(/[?？]$/, '') === nq.replace(/[?？]$/, '')) {
        CFG.debug && console.log('[Match] 精确:', k.substring(0,40), '->', v);
        return v;
      }
    }
    let best = null, bestSim = 0;
    for (const [k, v] of Object.entries(db)) {
      const sim = strSim(nq, cleanText(k));
      if (CFG.fuzzyEnable && sim >= CFG.fuzzyThresh && sim > bestSim) { best = v; bestSim = sim; }
    }
    if (best) CFG.debug && console.log('[Match] 模糊(' + bestSim.toFixed(2) + '):', best);
    return best;
  }

  /* =========================================================
     规则推断引擎（无题库命中时的智能兜底）
  ========================================================= */
  function ruleInfer(qText, inputs) {
    /**
     * 取选项文本（兼容 MinuteStars label 包裹 input 的 DOM 结构）
     */
    const getOptText = i => {
      const label = i.closest('label') || i.parentElement;
      return label ? label.textContent.replace(/\s+/g, ' ').trim() : (i.value || '');
    };
    const texts = inputs.map(getOptText);

    // ── 判断题识别（只有两个选项，分别为 对/错）──────────────────────
    const isJudge = inputs.length === 2 && (
      texts.some(t => /^[A-D]?\.\s*(对|正确|是|√|true)$/i.test(t) || t === '对' || t === '正确') &&
      texts.some(t => /^[A-D]?\.\s*(错|错误|否|×|false)$/i.test(t) || t === '错' || t === '错误')
    );
    if (isJudge) {
      const negWords = ['不能','不是','不得','不应','不正确','不合法','错误','不允许','不需要','不必须','不可以','不会'];
      return negWords.some(w => qText.includes(w)) ? 'false' : 'true';
    }

    // ── 单选：选项含"以上都是/以上都对/全部"且题目问"正确" ────────────
    if (inputs.length > 0 && inputs[0].type === 'radio') {
      const allAboveIdx = texts.findIndex(t => t.includes('以上都') || t.includes('全部正确') || t.includes('全部以上'));
      if (allAboveIdx !== -1 && /正确|对的/.test(qText)) return String.fromCharCode(65 + allAboveIdx);
      // 反向：题目问"错误"且有"以上都不"选项
      const noneIdx = texts.findIndex(t => t.includes('以上都不') || t.includes('全都不'));
      if (noneIdx !== -1 && /错误|不正确/.test(qText)) return String.fromCharCode(65 + noneIdx);
    }

    return null;
  }

  /* =========================================================
     工具函数
  ========================================================= */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* =========================================================
     样式
  ========================================================= */
  GM_addStyle(`
    /* ---- 主面板 ---- */
    #ata-panel {
      position:fixed;top:10px;right:10px;z-index:999999;
      background:#0f1117;color:#e2e8f0;
      border:1px solid rgba(79,195,247,.35);border-radius:14px;
      padding:0;font-family:'Microsoft YaHei','PingFang SC',sans-serif;
      font-size:13px;box-shadow:0 8px 32px rgba(0,0,0,.55);
      width:320px;height:480px; /* 固定初始大小 */
      overflow:hidden;
      display:flex;flex-direction:column;user-select:none;
    }
    #ata-panel::-webkit-scrollbar{width:3px;}
    #ata-panel::-webkit-scrollbar-thumb{background:rgba(79,195,247,.4);border-radius:2px;}
    /* 手动调整大小的拖拽区域 */
    #ata-resize-handle{
      position:absolute;bottom:0;right:0;width:16px;height:16px;
      cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,rgba(79,195,247,.3) 50%);
      border-radius:0 0 14px 0;
    }

    /* 顶部标题栏 */
    .ata-hdr{
      padding:12px 16px 10px;
      background:linear-gradient(135deg,#0d1b2e 0%,#162032 100%);
      border-radius:14px 14px 0 0;
      border-bottom:1px solid rgba(79,195,247,.2);
      display:flex;align-items:center;gap:10px;
    }
    .ata-hdr-icon{
      width:36px;height:36px;border-radius:10px;
      background:linear-gradient(135deg,#4fc3f7,#0284c7);
      display:flex;align-items:center;justify-content:center;
      font-size:18px;flex-shrink:0;
      box-shadow:0 2px 8px rgba(79,195,247,.4);
    }
    .ata-hdr-txt{flex:1;min-width:0;}
    .ata-hdr-title{font-size:14px;font-weight:700;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .ata-hdr-sub{font-size:11px;color:#64748b;margin-top:1px;}
    .ata-hdr-ver{
      font-size:10px;color:#4fc3f7;background:rgba(79,195,247,.12);
      border:1px solid rgba(79,195,247,.25);border-radius:20px;
      padding:1px 7px;flex-shrink:0;
    }
    .ata-close-btn{
      width:24px;height:24px;border-radius:6px;border:none;cursor:pointer;
      background:rgba(255,255,255,.06);color:#64748b;font-size:13px;
      display:flex;align-items:center;justify-content:center;
      transition:background .15s,color .15s;flex-shrink:0;
    }
    .ata-close-btn:hover{background:rgba(239,68,68,.2);color:#ef5350;}

    /* 统计卡片区 */
    .ata-stats{
      display:grid;grid-template-columns:repeat(4,1fr);
      gap:6px;padding:10px 12px;
      background:#0d1018;
      border-bottom:1px solid rgba(255,255,255,.05);
    }
    .ata-stat-card{
      background:rgba(255,255,255,.04);
      border:1px solid rgba(255,255,255,.06);
      border-radius:8px;padding:7px 4px;text-align:center;
      transition:background .15s;
    }
    .ata-stat-card:hover{background:rgba(255,255,255,.07);}
    .ata-stat-card .num{font-size:18px;font-weight:700;line-height:1.2;}
    .ata-stat-card .lab{font-size:10px;color:#64748b;margin-top:2px;}
    .ata-stat-card.green .num{color:#4ade80;}
    .ata-stat-card.red   .num{color:#f87171;}
    .ata-stat-card.blue  .num{color:#4fc3f7;}
    .ata-stat-card.gray  .num{color:#94a3b8;}

    /* 进度条 */
    .ata-prog-wrap{padding:10px 14px 6px;}
    .ata-prog-meta{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;}
    .ata-prog-label{font-size:11px;color:#64748b;}
    .ata-prog-pct{font-size:12px;font-weight:700;color:#4fc3f7;}
    .ata-prog{height:6px;background:#1e293b;border-radius:10px;overflow:hidden;}
    .ata-prog-bar{
      height:100%;border-radius:10px;width:0;transition:width .5s ease;
      background:linear-gradient(90deg,#4fc3f7,#38bdf8);
    }

    /* 操作按钮区 */
    .ata-actions{padding:6px 12px 4px;}
    .ata-btn-row{display:flex;gap:5px;flex-wrap:wrap;}
    .ata-btn{
      display:inline-flex;align-items:center;justify-content:center;gap:4px;
      background:#1e293b;color:#94a3b8;border:1px solid rgba(255,255,255,.08);
      border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;
      font-weight:600;transition:all .18s;white-space:nowrap;
    }
    .ata-btn:hover{background:#2d3a4f;color:#e2e8f0;border-color:rgba(255,255,255,.15);}
    .ata-btn.green{background:rgba(74,222,128,.12);color:#4ade80;border-color:rgba(74,222,128,.25);}
    .ata-btn.green:hover{background:rgba(74,222,128,.2);}
    .ata-btn.red{background:rgba(248,113,113,.12);color:#f87171;border-color:rgba(248,113,113,.25);}
    .ata-btn.red:hover{background:rgba(248,113,113,.2);}
    .ata-btn.orange{background:rgba(251,191,36,.12);color:#fbbf24;border-color:rgba(251,191,36,.25);}
    .ata-btn.orange:hover{background:rgba(251,191,36,.2);}
    .ata-btn.blue{background:rgba(79,195,247,.12);color:#4fc3f7;border-color:rgba(79,195,247,.25);}
    .ata-btn.blue:hover{background:rgba(79,195,247,.2);}
    .ata-btn.purple{background:rgba(167,139,250,.12);color:#a78bfa;border-color:rgba(167,139,250,.25);font-size:11px;padding:5px 10px;}
    .ata-btn.purple:hover{background:rgba(167,139,250,.2);}
    .ata-btn.yellow{background:rgba(251,191,36,.12);color:#fbbf24;border-color:rgba(251,191,36,.25);}
    .ata-btn.yellow:hover{background:rgba(251,191,36,.2);}

    /* 面板收起 */
    #ata-panel.collapsed #ata-body,
    #ata-panel.collapsed .ata-log-wrap { display:none; }
    #ata-panel.collapsed .ata-hdr { border-radius:12px; }
    #ata-panel.collapsed { height:auto; }
    /* 收起时隐藏收起按钮自身 */
    #ata-panel.collapsed #ata-collapse-panel { display:none; }
    /* 展开时隐藏展开按钮 */
    #ata-expand-btn { display:none; }
    #ata-panel.collapsed #ata-expand-btn { display:inline-flex; }

    /* 答题状态条 */
    .ata-status-bar{
      margin:4px 12px 6px;
      background:#1a2332;border:1px solid rgba(255,255,255,.05);
      border-radius:8px;padding:7px 12px;
      display:flex;align-items:center;gap:8px;font-size:12px;
    }
    .ata-status-dot{
      width:8px;height:8px;border-radius:50%;flex-shrink:0;
      background:#64748b;
    }
    .ata-status-dot.running{background:#4ade80;box-shadow:0 0 6px rgba(74,222,128,.6);animation:ata-pulse 1.5s infinite;}
    .ata-status-dot.done{background:#4fc3f7;}
    .ata-status-dot.idle{background:#64748b;}
    @keyframes ata-pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .ata-status-text{color:#94a3b8;flex:1;}
    .ata-status-text span{color:#e2e8f0;font-weight:600;}

    /* 设置折叠区 */
    .ata-collapse-hd{
      display:flex;justify-content:space-between;align-items:center;
      cursor:pointer;padding:7px 12px;
      margin:4px 10px 0;
      border-radius:8px;
      background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);
      font-size:12px;color:#64748b;user-select:none;transition:all .15s;
    }
    .ata-collapse-hd:hover{background:rgba(255,255,255,.06);color:#94a3b8;}
    .ata-collapse-hd.open{border-color:rgba(79,195,247,.2);color:#4fc3f7;background:rgba(79,195,247,.06);}
    .ata-collapse-body{
      margin:0 10px 6px;
      background:#111827;border:1px solid rgba(255,255,255,.05);
      border-top:none;border-radius:0 0 10px 10px;padding:10px;
      display:none;
    }
    .ata-collapse-body.open{display:block;}
    .ata-section-title{font-size:10px;color:#4fc3f7;letter-spacing:.5px;
      font-weight:700;text-transform:uppercase;
      margin:8px 0 5px;padding-bottom:4px;border-bottom:1px solid rgba(79,195,247,.12);}
    .ata-section-title:first-child{margin-top:0;}
    .ata-row{display:flex;align-items:center;gap:6px;margin:5px 0;font-size:12px;flex-wrap:wrap;}
    .ata-label{color:#94a3b8;min-width:110px;flex-shrink:0;font-size:11px;}
    .ata-hint{font-size:11px;color:#4ade80;min-width:20px;}
    .ata-divider{border:none;border-top:1px solid rgba(255,255,255,.05);margin:8px 0;}

    /* Toggle 开关 */
    .ata-toggle{position:relative;display:inline-block;width:36px;height:20px;flex-shrink:0;}
    .ata-toggle input{opacity:0;width:0;height:0;}
    .ata-slider{position:absolute;inset:0;background:#334155;border-radius:20px;cursor:pointer;transition:.25s;}
    .ata-slider:before{content:'';position:absolute;width:14px;height:14px;border-radius:50%;background:#fff;left:3px;top:3px;transition:.25s;}
    .ata-toggle input:checked+.ata-slider{background:#4fc3f7;}
    .ata-toggle input:checked+.ata-slider:before{transform:translateX(16px);}

    /* 输入框 */
    .ata-num-input{width:64px;background:#0d1018;border:1px solid rgba(255,255,255,.08);color:#e2e8f0;border-radius:6px;padding:3px 6px;font-size:12px;text-align:center;}
    .ata-num-input:focus{border-color:#4fc3f7;outline:none;}
    .ata-text-input{flex:1;min-width:90px;background:#0d1018;border:1px solid rgba(255,255,255,.08);color:#e2e8f0;border-radius:6px;padding:3px 7px;font-size:12px;}
    .ata-text-input:focus{border-color:#4fc3f7;outline:none;}
    .ata-range{flex:1;min-width:70px;accent-color:#4fc3f7;height:4px;cursor:pointer;}
    .ata-range-val{font-size:11px;color:#fbbf24;min-width:32px;text-align:right;}

    /* 底部日志 */
    .ata-log-wrap{padding:6px 12px 10px;margin-top:auto;}
    .ata-log-hdr{font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}
    .ata-log{max-height:72px;overflow-y:auto;font-size:11px;color:#64748b;
      background:#0a0d12;border-radius:6px;padding:5px 8px;
      border:1px solid rgba(255,255,255,.04);
      font-family:Consolas,'Microsoft YaHei',monospace;line-height:1.7;}

    /* 题库标记 */
    .ata-answered{background:rgba(74,222,128,.10)!important;outline:1px solid rgba(74,222,128,.4)!important;}
    .ata-no-match{background:rgba(248,113,113,.08)!important;outline:1px dashed rgba(248,113,113,.35)!important;}

    /* 题库管理弹窗 */
    #ata-lib-modal{display:none;position:fixed;inset:0;z-index:10000000;
      background:rgba(0,0,0,.7);align-items:center;justify-content:center;}
    #ata-lib-modal.show{display:flex;}
    #ata-lib-box{background:#0f1117;border:1px solid rgba(79,195,247,.3);border-radius:14px;
      width:760px;max-width:96vw;max-height:88vh;
      display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.7);}
    #ata-lib-header{display:flex;align-items:center;justify-content:space-between;
      padding:14px 18px;background:linear-gradient(135deg,#0d1b2e,#162032);
      border-bottom:1px solid rgba(79,195,247,.15);border-radius:14px 14px 0 0;}
    #ata-lib-header h3{margin:0;color:#e2e8f0;font-size:14px;}
    #ata-lib-close{background:rgba(255,255,255,.06);border:none;color:#64748b;font-size:14px;
      cursor:pointer;line-height:1;padding:5px 9px;border-radius:6px;transition:all .15s;}
    #ata-lib-close:hover{background:rgba(239,68,68,.2);color:#ef5350;}
    #ata-lib-tabs{display:flex;padding:8px 16px;gap:4px;
      background:#0d1018;border-bottom:1px solid rgba(255,255,255,.05);}
    .ata-tab{padding:5px 14px;border-radius:7px;cursor:pointer;font-size:12px;
      color:#64748b;border:1px solid transparent;transition:all .2s;}
    .ata-tab:hover{color:#94a3b8;background:rgba(255,255,255,.04);}
    .ata-tab.active{color:#4fc3f7;background:rgba(79,195,247,.08);border-color:rgba(79,195,247,.3);font-weight:600;}
    #ata-lib-body{flex:1;overflow-y:auto;padding:14px 18px;}
    #ata-lib-body::-webkit-scrollbar{width:3px;}
    #ata-lib-body::-webkit-scrollbar-thumb{background:rgba(79,195,247,.4);border-radius:2px;}
    .ata-pane{display:none;} .ata-pane.active{display:block;}
    .ata-stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;}
    .ata-stat-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:10px;text-align:center;}
    .ata-stat-card .num{font-size:20px;font-weight:700;color:#4fc3f7;}
    .ata-stat-card .lab{font-size:10px;color:#64748b;margin-top:3px;}
    .ata-lib-format{background:rgba(251,191,36,.06);border-radius:8px;padding:10px;font-size:11px;color:#94a3b8;
      line-height:1.7;margin-bottom:10px;border-left:3px solid rgba(251,191,36,.4);}
    .ata-lib-format code{color:#4fc3f7;}
    .ata-lib-textarea{width:100%;min-height:150px;background:#0d1018;border:1px solid rgba(255,255,255,.08);
      color:#e2e8f0;border-radius:8px;padding:8px;font-size:12px;font-family:Consolas,monospace;
      resize:vertical;box-sizing:border-box;}
    .ata-lib-textarea:focus{border-color:#4fc3f7;outline:none;}
    .ata-import-result{margin-top:6px;font-size:12px;padding:6px 10px;border-radius:6px;display:none;}
    .ata-import-result.ok{display:block;background:rgba(74,222,128,.1);color:#4ade80;border:1px solid rgba(74,222,128,.2);}
    .ata-import-result.err{display:block;background:rgba(248,113,113,.1);color:#f87171;border:1px solid rgba(248,113,113,.2);}
    .ata-lib-table{width:100%;border-collapse:collapse;font-size:11px;}
    .ata-lib-table th{background:rgba(79,195,247,.06);color:#4fc3f7;padding:6px 10px;text-align:left;
      position:sticky;top:0;z-index:1;font-size:10px;text-transform:uppercase;letter-spacing:.5px;
      border-bottom:1px solid rgba(255,255,255,.06);}
    .ata-lib-table td{padding:5px 10px;border-bottom:1px solid rgba(255,255,255,.04);color:#94a3b8;vertical-align:top;}
    .ata-lib-table tr:hover td{background:rgba(79,195,247,.03);}
    .ata-lib-table .q-cell{max-width:400px;word-break:break-all;}
    .ata-lib-table .ans-cell{color:#4fc3f7;font-weight:700;}
    .ata-lib-table .del-btn{background:rgba(248,113,113,.1);color:#f87171;border:none;
      border-radius:4px;padding:2px 7px;cursor:pointer;font-size:11px;transition:background .15s;}
    .ata-lib-table .del-btn:hover{background:rgba(248,113,113,.25);}
    #ata-lib-search{width:100%;background:#0d1018;border:1px solid rgba(255,255,255,.08);color:#e2e8f0;
      border-radius:8px;padding:6px 10px;font-size:12px;margin-bottom:8px;box-sizing:border-box;}
    #ata-lib-search:focus{border-color:#4fc3f7;outline:none;}
    .ata-lib-pager{display:flex;justify-content:space-between;align-items:center;
      margin-top:8px;font-size:11px;color:#64748b;}
    .ata-add-row{display:flex;gap:6px;margin-bottom:8px;}
    .ata-add-row input{flex:1;background:#0d1018;border:1px solid rgba(255,255,255,.08);color:#e2e8f0;
      border-radius:6px;padding:5px 8px;font-size:12px;}
    .ata-add-row input:focus{border-color:#4fc3f7;outline:none;}
    #ata-file-input{display:none;}
  `);

  /* =========================================================
     页面检测
  ========================================================= */
  const isLoginPage  = () => /\/login\.aspx$/i.test(location.pathname);
  const isAnswerPage = () => /\/exams\/test\/dotest\.aspx$/.test(location.pathname);
  const isViewPage   = () => /\/exams\/test\/score\/viewanswer\.aspx$/.test(location.pathname);

  /* =========================================================
     自动登录
  ========================================================= */
  function handleLogin() {
    if (!CFG.autoLogin) return;
    const user = $('#txtUserName'), pass = $('#txtPassword'), btn = $('#btnLogin');
    if (!user || !pass || !btn) return;
    if (user.value) return; // 已填过

    const errEl = $('#MessageError');
    if (errEl && errEl.textContent.trim()) return;

    setTimeout(() => {
      user.value = CFG.username;
      ['input','change'].forEach(ev => user.dispatchEvent(new Event(ev, {bubbles:true})));
    }, 300);
    setTimeout(() => {
      pass.value = CFG.password;
      ['input','change'].forEach(ev => pass.dispatchEvent(new Event(ev, {bubbles:true})));
    }, 600);
    setTimeout(() => {
      const captcha = $('#txtCapcha'), captchaWrap = $('#liCapcha');
      if (captcha && captchaWrap && getComputedStyle(captchaWrap).display !== 'none') {
        captchaWrap.style.border = '2px solid red';
        console.log('[ATA] 需要验证码，请手动填写');
      } else {
        btn.click();
      }
    }, 1000);
  }

  // 先执行登录逻辑（任何页面）
  handleLogin();

  // 非答题/查看答案页静默退出
  if (!isAnswerPage() && !isViewPage()) return;

  /* =========================================================
     主面板
  ========================================================= */
  const panel = document.createElement('div');
  panel.id = 'ata-panel';
  panel.innerHTML = `
    <!-- 标题栏 -->
    <div class="ata-hdr">
      <div class="ata-hdr-icon">🤖</div>
      <div class="ata-hdr-txt">
        <div class="ata-hdr-title">千寻宜 MinuteStars 答题器</div>
        <div class="ata-hdr-sub">题库 <span id="ata-lib-count">${LibraryManager.count + Object.keys(BUILTIN_DB).length}</span> 条</div>
      </div>
      <span class="ata-hdr-ver">${SCRIPT_VERSION}</span>
      <button class="ata-close-btn" id="ata-collapse-panel" title="收起面板">▼</button>
      <button class="ata-close-btn" id="ata-expand-btn" title="展开面板">▲</button>
      <button class="ata-close-btn" id="ata-close" title="关闭面板">✕</button>
    </div>

    <!-- 面板主体（收起时隐藏） -->
    <div id="ata-body">

    <!-- 统计卡片 -->
    <div class="ata-stats">
      <div class="ata-stat-card blue">
        <div class="num" id="ata-stat-total">0</div>
        <div class="lab">总题数</div>
      </div>
      <div class="ata-stat-card green">
        <div class="num" id="ata-stat-answered">0</div>
        <div class="lab">已答题</div>
      </div>
      <div class="ata-stat-card green">
        <div class="num" id="ata-stat-hit">0</div>
        <div class="lab">命中</div>
      </div>
      <div class="ata-stat-card red">
        <div class="num" id="ata-stat-miss">0</div>
        <div class="lab">未命中</div>
      </div>
    </div>

    <!-- 进度条 -->
    <div class="ata-prog-wrap">
      <div class="ata-prog-meta">
        <span class="ata-prog-label">答题进度</span>
        <span class="ata-prog-pct" id="ata-prog-pct">0%</span>
      </div>
      <div class="ata-prog"><div class="ata-prog-bar" id="ata-bar"></div></div>
    </div>

    <!-- 状态指示条 -->
    <div class="ata-status-bar">
      <div class="ata-status-dot idle" id="ata-status-dot"></div>
      <div class="ata-status-text" id="ata-status-text">等待开始</div>
    </div>

    <!-- 主操作按钮 -->
    <div class="ata-actions">
      <div class="ata-btn-row">
        <button class="ata-btn green"  id="ata-start">▶ 开始答题</button>
        <button class="ata-btn yellow" id="ata-pause" style="display:none">⏸ 暂停</button>
        <button class="ata-btn red"    id="ata-stop">■ 停止</button>
        <button class="ata-btn"        id="ata-reset">↺ 重置</button>
        <button class="ata-btn blue"   id="ata-submit">✔ 提交</button>
      </div>
      <div class="ata-btn-row" style="margin-top:5px">
        <button class="ata-btn"      id="ata-scan">🔍 扫描</button>
        <button class="ata-btn"      id="ata-collect">📥 采集</button>
        <button class="ata-btn purple" id="ata-open-lib">📚 题库</button>
      </div>
    </div>

    <!-- 设置折叠区 -->
    <div class="ata-collapse-hd" id="ata-settings-hd">
      <span>⚙ 设置</span><span id="ata-settings-arrow">▼</span>
    </div>
    <div class="ata-collapse-body" id="ata-settings-body">

      <div class="ata-section-title">匹配策略</div>
      <div class="ata-row">
        <span class="ata-label">模糊匹配</span>
        <label class="ata-toggle"><input type="checkbox" id="cfg-fuzzy-enable"><span class="ata-slider"></span></label>
        <span class="ata-hint" id="cfg-fuzzy-hint">开</span>
      </div>
      <div class="ata-row">
        <span class="ata-label">匹配阈值</span>
        <input type="range" id="cfg-fuzzy-thresh" min="50" max="95" step="5" class="ata-range">
        <span class="ata-range-val" id="cfg-thresh-val">75%</span>
      </div>

      <div class="ata-section-title">答题行为</div>
      <div class="ata-row">
        <span class="ata-label">加载后自动答题</span>
        <label class="ata-toggle"><input type="checkbox" id="cfg-auto-answer"><span class="ata-slider"></span></label>
      </div>
      <div class="ata-row">
        <span class="ata-label">答完自动提交</span>
        <label class="ata-toggle"><input type="checkbox" id="cfg-auto-submit"><span class="ata-slider"></span></label>
      </div>
      <div class="ata-row">
        <span class="ata-label">每题延迟</span>
        <input type="number" id="cfg-answer-delay" min="0" max="3000" step="50" class="ata-num-input"> ms
      </div>
      <div class="ata-row">
        <span class="ata-label">提交延迟</span>
        <input type="number" id="cfg-submit-min" min="5" max="600" class="ata-num-input" style="width:54px">
        <span style="color:#475569">~</span>
        <input type="number" id="cfg-submit-max" min="5" max="600" class="ata-num-input" style="width:54px"> s
      </div>

      <div class="ata-section-title">自动登录</div>
      <div class="ata-row">
        <span class="ata-label">启用</span>
        <label class="ata-toggle"><input type="checkbox" id="cfg-auto-login"><span class="ata-slider"></span></label>
      </div>
      <div id="cfg-login-fields">
        <div class="ata-row">
          <span class="ata-label">用户名</span>
          <input type="text"     id="cfg-username" class="ata-text-input" placeholder="登录账号" autocomplete="off">
        </div>
        <div class="ata-row">
          <span class="ata-label">密码</span>
          <input type="password" id="cfg-password" class="ata-text-input" placeholder="登录密码" autocomplete="off">
          <button class="ata-btn" id="cfg-eye" style="padding:3px 8px;font-size:12px;margin-left:3px">👁</button>
        </div>
      </div>

      <div class="ata-section-title">调试</div>
      <div class="ata-row">
        <span class="ata-label">控制台日志</span>
        <label class="ata-toggle"><input type="checkbox" id="cfg-debug"><span class="ata-slider"></span></label>
      </div>
      <div style="margin-top:6px;display:flex;gap:6px">
        <button class="ata-btn green" id="cfg-save">💾 保存</button>
        <button class="ata-btn"       id="cfg-reset-defaults">↺ 恢复默认</button>
      </div>
      <div id="cfg-save-msg" style="font-size:11px;color:#4ade80;margin-top:3px;height:16px"></div>
    </div>

    <!-- 底部日志 -->
    <div class="ata-log-wrap">
      <div class="ata-log-hdr">运行日志</div>
      <div class="ata-log" id="ata-log"></div>
    </div>

    <!-- 手动调整大小的拖拽手柄 -->
    <div id="ata-resize-handle"></div>
  </div>
`;
  document.body.appendChild(panel);

  /* =========================================================
     题库管理弹窗
  ========================================================= */
  const modal = document.createElement('div');
  modal.id = 'ata-lib-modal';
  modal.innerHTML = `
    <div id="ata-lib-box">
      <div id="ata-lib-header">
        <h3>📚 题库管理 — 共 <span id="ata-lib-total">0</span> 条</h3>
        <button id="ata-lib-close">✕</button>
      </div>
      <div id="ata-lib-tabs">
        <div class="ata-tab active" data-tab="stats">📊 统计</div>
        <div class="ata-tab" data-tab="bulk">📥 批量导入</div>
        <div class="ata-tab" data-tab="single">➕ 单条添加</div>
        <div class="ata-tab" data-tab="browse">🔍 浏览题库</div>
        <div class="ata-tab" data-tab="export">📤 导出</div>
      </div>
      <div id="ata-lib-body">

        <div class="ata-pane active" id="pane-stats">
          <div class="ata-stat-grid">
            <div class="ata-stat-card"><div class="num" id="stat-total">0</div><div class="lab">题库总数</div></div>
            <div class="ata-stat-card"><div class="num" id="stat-single">0</div><div class="lab">单选/判断</div></div>
            <div class="ata-stat-card"><div class="num" id="stat-multi">0</div><div class="lab">多选题</div></div>
            <div class="ata-stat-card"><div class="num" id="stat-user">0</div><div class="lab">自定义添加</div></div>
          </div>
          <div style="font-size:12px;color:#aaa;margin-bottom:10px">
            内置 ${Object.keys(BUILTIN_DB).length} 条（固定）+ 自定义 <span id="stat-uc">0</span> 条（可增删）
          </div>
          <button class="ata-btn red" id="ata-clear-lib">🗑️ 清空自定义题库</button>
          <div id="ata-clear-confirm" style="display:none;margin-top:6px;font-size:12px;color:#ef5350">
            ⚠️ 确认清空？
            <button class="ata-btn red"    id="ata-clear-yes" style="padding:2px 10px;font-size:11px">确定</button>
            <button class="ata-btn yellow" id="ata-clear-no"  style="padding:2px 10px;font-size:11px">取消</button>
          </div>
        </div>

        <div class="ata-pane" id="pane-bulk">
          <div class="ata-lib-format">
            <b>支持格式（每行一条）：</b><br>
            <code>题目||答案</code> 或 <code>题目|答案</code><br>
            多选：<code>A,B,C</code>；判断：<code>true</code> / <code>false</code>
          </div>
          <textarea class="ata-lib-textarea" id="ata-bulk-text" placeholder="粘贴题库内容...&#10;示例：&#10;出差补助按地区划分为三类，正确的是？||A,B,C"></textarea>
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <button class="ata-btn green"  id="ata-do-import">✅ 导入</button>
            <button class="ata-btn yellow" id="ata-do-clipboard">📋 从剪贴板</button>
            <label class="ata-btn yellow" style="display:inline-block;margin:0;cursor:pointer">
              📂 从文本文件<input type="file" id="ata-file-input" accept=".txt,.json,.csv">
            </label>
          </div>
          <div style="margin-top:8px">
            <label class="ata-btn purple" style="display:inline-block;margin:0;cursor:pointer">
              📄 从 Word 文档导入（.docx）<input type="file" id="ata-docx-input" accept=".docx" style="display:none">
            </label>
            <span id="ata-docx-msg" style="font-size:11px;margin-left:8px;color:#aaa"></span>
          </div>
          <div class="ata-import-result" id="ata-import-result"></div>
        </div>

        <div class="ata-pane" id="pane-single">
          <div class="ata-add-row"><input id="ata-single-q" placeholder="题目（粘贴或输入）" /></div>
          <div class="ata-add-row">
            <input id="ata-single-a" placeholder="答案：A 或 A,B,C 或 true" style="flex:0 0 220px" />
            <button class="ata-btn green" id="ata-single-add" style="flex:0 0 80px">添加</button>
          </div>
          <div id="ata-single-msg" style="font-size:12px;margin-bottom:8px"></div>
        </div>

        <div class="ata-pane" id="pane-browse">
          <input id="ata-lib-search" placeholder="🔍 搜索题目关键词..." />
          <div style="overflow:auto;max-height:400px">
            <table class="ata-lib-table">
              <thead><tr><th>题目</th><th>答案</th><th>操作</th></tr></thead>
              <tbody id="ata-lib-tbody"></tbody>
            </table>
          </div>
          <div class="ata-lib-pager">
            <span id="ata-pager-info">共 0 条</span>
            <div style="display:flex;gap:4px">
              <button class="ata-btn" id="ata-pager-prev">◀</button>
              <button class="ata-btn" id="ata-pager-next">▶</button>
            </div>
          </div>
        </div>

        <div class="ata-pane" id="pane-export">
          <div class="ata-lib-format">
            <b>导出说明：</b><br>
            <code>JSON</code> — 完整数据，可直接导入恢复<br>
            <code>TXT</code>  — 每行 <code>题目||答案</code>，可用 Excel 编辑
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <button class="ata-btn green"  id="ata-export-json">📥 导出 JSON（含内置）</button>
            <button class="ata-btn yellow" id="ata-export-user-json">📥 仅导出自定义</button>
            <button class="ata-btn yellow" id="ata-export-txt">📥 导出 TXT</button>
          </div>
          <hr style="border-color:#333">
          <div style="margin-top:12px">
            <div style="font-size:12px;color:#ef5350;margin-bottom:8px">⚠️ 危险操作</div>
            <button class="ata-btn red" id="ata-clear-user">🗑 清空自定义题库</button>
          </div>
        </div>

      </div>
    </div>
  `;
  document.body.appendChild(modal);

  /* =========================================================
     题库管理 UI 逻辑
  ========================================================= */
  function refreshLibCount() {
    const uc = LibraryManager.count;
    const total = uc + Object.keys(BUILTIN_DB).length;
    const el1 = $('#ata-lib-count'), el3 = $('#ata-lib-total');
    if (el1) el1.textContent = total;
    if (el3) el3.textContent = total;
  }

  function refreshStats() {
    const db    = getMergedDB();
    const total = Object.keys(db).length;
    let single = 0, multi = 0;
    for (const v of Object.values(db)) {
      String(v).includes(',') ? multi++ : single++;
    }
    const uc = LibraryManager.count;
    [['stat-total', total],['stat-single', single],['stat-multi', multi],['stat-user', uc],['stat-uc', uc]].forEach(([id, val]) => {
      const el = $(('#'+id)); if (el) el.textContent = val;
    });
    const el = $('#ata-lib-total'); if (el) el.textContent = total;
  }

  // Tab 切换
  $$('.ata-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.ata-tab').forEach(t => t.classList.remove('active'));
      $$('.ata-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $('#pane-' + tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'stats')  refreshStats();
      if (tab.dataset.tab === 'browse') renderBrowse(1);
    });
  });

  $('#ata-open-lib').addEventListener('click', () => {
    modal.classList.add('show');
    refreshStats();
    renderBrowse(1);
  });
  $('#ata-lib-close').addEventListener('click', () => modal.classList.remove('show'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });

  // 导入
  function showImportResult(msg, ok) {
    const el = $('#ata-import-result');
    if (!el) return;
    el.textContent = msg;
    el.className = 'ata-import-result ' + (ok ? 'ok' : 'err');
    setTimeout(() => { el.style.display = 'none'; }, 5000);
  }
  function doImport(text) {
    if (!text.trim()) { showImportResult('请输入题库内容！', false); return; }
    const r = LibraryManager.addBulk(text);
    showImportResult('✅ 导入 ' + r.added + ' 条' + (r.skipped > 0 ? '，跳过 ' + r.skipped + ' 条' : ''), true);
    refreshLibCount(); refreshStats(); renderBrowse(currentPage);
    $('#ata-bulk-text').value = '';
  }
  $('#ata-do-import').addEventListener('click', () => doImport($('#ata-bulk-text').value));
  $('#ata-do-clipboard').addEventListener('click', async () => {
    try { doImport(await navigator.clipboard.readText()); }
    catch { showImportResult('❌ 无法读取剪贴板', false); }
  });
  $('#ata-file-input').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => { doImport(ev.target.result); e.target.value = ''; };
    r.readAsText(f);
  });

  /* =========================================================
     Word 文档（.docx）解析器
     原理：docx 是 zip 压缩包 → 解压 word/document.xml → DOMParser → 按段落提取题目+答案
  ========================================================= */
  function showDocxMsg(msg, ok) {
    const el = document.getElementById('ata-docx-msg');
    if (!el) return;
    // 强制 reflow 后写 innerHTML，支持 HTML 格式消息
    void el.offsetWidth;
    el.innerHTML = msg;
    el.style.color = ok ? '#66bb6a' : '#ef5350';
    setTimeout(() => { el.innerHTML = ''; }, 6000);
  }

  /**
   * 解析 .docx 文件，返回 { added, skipped, errors, preview[] }
   * @param {Blob} blob
   * @returns {Promise}
   */
  function parseDocxBlob(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = function (e) {
        try {
          const buffer = e.target.result;

          // ── JSZip 在线解压（无需外链，用内联简化版 zip parser）──────────
          // 这里用 TextDecoder 读取文档 XML 内容
          // docx 的 word/document.xml 是 Deflate 压缩的，需要 pako 等库
          // 为避免外部依赖，直接检测文本特征（多数 docx 的 document.xml
          // 纯文本部分可直接 readAsText 读取）：
          // 实际上 .docx 的 XML 部分是 DEFLATE 压缩的，直接 readAsText 读不到
          // 我们改用同步 fetch + JSZip CDN
          loadJsZipAndParse(buffer).then(resolve).catch(reject);
        } catch (err) {
          reject(err);
        }
      };

      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsArrayBuffer(blob);
    });
  }

  /**
   * 动态加载 JSZip 并解析 docx buffer
   * @param {ArrayBuffer} buffer
   * @returns {Promise<{added, skipped, errors, preview}>}
   */
  function loadJsZipAndParse(buffer) {
    return new Promise((resolve, reject) => {
      // 已有 JSZip 则复用，避免重复加载
      if (typeof JSZip !== 'undefined') {
        doParse(buffer);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.onload = () => { try { doParse(buffer); } catch (err) { reject(err); } };
      script.onerror = () => reject(new Error('无法加载 JSZip（网络问题），请检查网络后重试'));
      document.head.appendChild(script);

      function doParse(buf) {
        const zip = new JSZip();
        zip.loadAsync(buf).then(loaded => {
          // 尝试多种可能路径（Windows 不区分大小写，跨平台兼容）
          const xmlFile = loaded.file('word/document.xml')
                      || loaded.file('Word/document.xml')
                      || loaded.file('WORD/DOCUMENT.XML');
          if (!xmlFile) reject(new Error('ZIP 中未找到 word/document.xml（文件格式异常）'));
          return xmlFile.async('string');
        }).then(xmlStr => {
          resolve(parseDocxXML(xmlStr));
        }).catch(reject);
      }
    });
  }

  /**
   * 解析 document.xml 字符串，提取题目+答案
   * @param {string} xmlStr
   * @returns {{added, skipped, errors, preview[]}}
   */
  function parseDocxXML(xmlStr) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'application/xml');

    // 检查解析错误
    const errNode = doc.querySelector('parsererror');
    if (errNode) {
      // 尝试 text/xml 模式（某些文档格式）
      const altDoc = parser.parseFromString(xmlStr, 'text/xml');
      const altErr = altDoc.querySelector('parsererror');
      if (altErr) return { added: 0, skipped: 0, errors: ['XML 解析失败，文件可能已损坏'], preview: [] };
    }

    // getElementsByTagNameNS('*', 'p') 兼容所有命名空间前缀（w:p / w:pPr 等）
    const paras = doc.getElementsByTagNameNS('*', 'p');
    const db    = LibraryManager.load();
    let added = 0, skipped = 0;
    const preview = [];

    for (const p of paras) {
      // 提取段落内所有 <w:t> 文本节点并拼接（跨 run 还原段落完整文字）
      const tNodes = p.getElementsByTagNameNS('*', 't');
      const paraText = Array.from(tNodes).map(n => n.textContent || '').join('');
      if (!paraText.trim()) continue;

      // 以数字+分隔符开头的行才是题目
      if (!/^\d+[\.、\s　]/.test(paraText)) continue;

      // 提取 "答案：X" 部分
      const ansMatch = paraText.match(/答案[：:]\s*([A-Za-z,，]+)/);
      if (!ansMatch) continue;

      // 去掉末尾的 "答案：X  解析：..." 取题目文本
      const rawQ = paraText.replace(/答案[：:]\s*[A-Za-z,，]+.*$/, '').trim();

      // 去掉题号前缀和末尾出题人括号
      let qText = rawQ
        .replace(/^\d+[\.、\s　]+/, '')
        .replace(/\s*\（[^）]*\）\s*$/, '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim();
      if (qText.length < 4) { skipped++; continue; }

      // 解析答案
      let answer = ansMatch[1].toUpperCase().replace(/，/g, ',');

      // 判断题（A.对 / B.错 → true/false）
      if (/对/.test(paraText) && /错/.test(paraText)) {
        answer = (answer === 'A') ? 'true' : 'false';
      }

      if (!qText || !answer) { skipped++; continue; }

      // 去重
      const isDup = Object.keys(db).some(k => cleanText(k) === cleanText(qText));
      if (isDup) { skipped++; continue; }

      db[qText] = answer;
      added++;
      preview.push({ q: qText.substring(0, 60), a: answer });
    }

    LibraryManager.save(db);
    return { added, skipped, errors: [], preview };
  }

  // Word 文档导入事件
  document.getElementById('ata-docx-input').addEventListener('change', async function (e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.docx')) {
      showDocxMsg('❌ 请选择 .docx 文件', false);
      e.target.value = '';
      return;
    }

    showDocxMsg('⏳ 正在解析 Word 文档…', false);

    try {
      const result = await parseDocxBlob(file);

      if (result.errors && result.errors.length > 0) {
        showDocxMsg('❌ ' + result.errors[0], false);
        return;
      }

      const { added, skipped, preview } = result;
      refreshLibCount();
      refreshStats();
      renderBrowse(1);

      // 预览前几条
      let previewHtml = '';
      if (preview.length > 0) {
        previewHtml = ' | 示例：' + preview.slice(0, 3).map(p =>
          '<span style="color:#ffa726">“' + p.q.substring(0, 30) + '…” → ' + p.a + '</span>'
        ).join(' &nbsp; ');
      }

            if (added === 0 && skipped === 0) {
        showDocxMsg('❌ 未找到任何题目（请确认文档格式：需包含「答案：X」格式）', false);
      } else {
        showDocxMsg(
          '✅ 成功导入 <b style="color:#66bb6a">' + added + '</b> 条' +
          (skipped > 0 ? '，跳过 <b style="color:#ffa726">' + skipped + '</b> 条（已存在）' : '') +
          previewHtml,
          true
        );
        uLog('📄 Word文档导入：新增 ' + added + ' 条（跳过 ' + skipped + ' 条）', added > 0 ? 'ok' : 'warn');
      }
    } catch (err) {
      console.error('[ATA] Docx parse error:', err);
      showDocxMsg('❌ 解析失败：' + err.message, false);
    }

    e.target.value = '';
  });

  // 清空
  $('#ata-clear-lib').addEventListener('click', () => { $('#ata-clear-confirm').style.display = 'block'; });
  $('#ata-clear-yes').addEventListener('click', () => {
    LibraryManager.clear();
    refreshLibCount(); refreshStats(); renderBrowse(1);
    $('#ata-clear-confirm').style.display = 'none';
    showImportResult('🗑️ 已清空自定义题库', true);
  });
  $('#ata-clear-no').addEventListener('click', () => { $('#ata-clear-confirm').style.display = 'none'; });

  // 单条添加
  let _singleT = null;
  function showSingleMsg(msg, ok) {
    const el = $('#ata-single-msg');
    if (!el) return;
    el.textContent = msg; el.style.color = ok ? '#66bb6a' : '#ef5350';
    clearTimeout(_singleT);
    _singleT = setTimeout(() => { el.textContent = ''; }, 3000);
  }
  $('#ata-single-add').addEventListener('click', () => {
    const q = $('#ata-single-q').value.trim(), a = $('#ata-single-a').value.trim();
    if (!q) { showSingleMsg('请输入题目！', false); return; }
    if (!a) { showSingleMsg('请输入答案！', false); return; }
    LibraryManager.add(q, a);
    $('#ata-single-q').value = ''; $('#ata-single-a').value = '';
    refreshLibCount(); refreshStats();
    showSingleMsg('✅ 已添加（自定义 ' + LibraryManager.count + ' 条）', true);
  });
  $('#ata-single-q').addEventListener('keydown', e => { if (e.key === 'Enter') $('#ata-single-a').focus(); });
  $('#ata-single-a').addEventListener('keydown', e => { if (e.key === 'Enter') $('#ata-single-add').click(); });

  // 导出
  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  $('#ata-export-json').addEventListener('click', () => {
    downloadFile(JSON.stringify(getMergedDB(), null, 2), 'MinuteStars题库_all_' + Date.now() + '.json', 'application/json');
  });
  $('#ata-export-user-json').addEventListener('click', () => {
    downloadFile(LibraryManager.exportJSON(), 'MinuteStars题库_user_' + Date.now() + '.json', 'application/json');
  });
  $('#ata-export-txt').addEventListener('click', () => {
    const all = getMergedDB();
    const txt = Object.entries(all).map(([q, a]) => q + '||' + a).join('\n');
    downloadFile(txt, 'MinuteStars题库_' + Date.now() + '.txt', 'text/plain;charset=utf-8');
  });
  $('#ata-clear-user').addEventListener('click', () => {
    if (!confirm('⚠️ 确定清空全部自定义题库？内置题库不受影响。')) return;
    LibraryManager.clear();
    refreshLibCount(); refreshStats(); renderBrowse(1);
  });

  // 浏览题库（分页）
  let currentPage = 1;
  const PAGE_SIZE = 20;
  function renderBrowse(page) {
    currentPage = page;
    const keyword = ($('#ata-lib-search') ? $('#ata-lib-search').value : '').toLowerCase();
    const db      = getMergedDB();
    const entries = Object.entries(db).filter(([q]) => q.toLowerCase().includes(keyword));
    const total   = entries.length;
    const start   = (page - 1) * PAGE_SIZE;
    const slice   = entries.slice(start, start + PAGE_SIZE);
    const tbody   = $('#ata-lib-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!slice.length) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#666;padding:20px">没有匹配的题目</td></tr>';
    }
    slice.forEach(([q, a]) => {
      const isBuiltin = !!BUILTIN_DB[q];
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="q-cell">' + escHtml(q) + '</td>'
        + '<td style="color:#ffa726;font-weight:bold">' + escHtml(String(a)) + '</td>'
        + '<td>' + (isBuiltin
          ? '<span style="color:#555;font-size:10px">内置</span>'
          : '<button class="del-btn" data-q="' + escHtml(q) + '">删除</button>') + '</td>';
      tbody.appendChild(tr);
    });
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    $('#ata-pager-info').textContent = '共 ' + total + ' 条，第 ' + page + '/' + totalPages + ' 页';
    $('#ata-pager-prev').disabled = page <= 1;
    $('#ata-pager-next').disabled = start + PAGE_SIZE >= total;
  }
  $('#ata-lib-search').addEventListener('input', () => renderBrowse(1));
  $('#ata-pager-prev').addEventListener('click', () => { if (currentPage > 1) renderBrowse(currentPage - 1); });
  $('#ata-pager-next').addEventListener('click', () => renderBrowse(currentPage + 1));
  $('#ata-lib-tbody').addEventListener('click', e => {
    if (e.target.classList.contains('del-btn')) {
      LibraryManager.remove(e.target.dataset.q);
      refreshLibCount(); refreshStats(); renderBrowse(currentPage);
    }
  });

  /* =========================================================
     答题核心逻辑
  ========================================================= */
  const logEl      = $('#ata-log');
  const statusDot  = $('#ata-status-dot');
  const statusText = $('#ata-status-text');

  function uLog(msg, cls) {
    if (!logEl) return;
    const colors = { ok:'#4ade80', warn:'#fbbf24', err:'#f87171', info:'#94a3b8' };
    const c = colors[cls] || '#94a3b8';
    const t = new Date().toLocaleTimeString();
    const d = document.createElement('div');
    d.innerHTML = '<span style="color:' + c + '">[' + t + '] ' + escHtml(msg) + '</span>';
    logEl.prepend(d);
    console.log('[ATA Pro]', msg);
  }

  function setProgress(cur, total) {
    const bar = $('#ata-bar'), pctEl = $('#ata-prog-pct');
    const pct = total ? Math.round(cur / total * 100) : 0;
    if (bar)   bar.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
  }

  function setRunningStatus(txt, mode) {
    if (statusDot)  statusDot.className  = 'ata-status-dot ' + (mode || 'idle');
    if (statusText) statusText.textContent = txt;
  }

  /** 从 MinuteStars .answer 容器提取题目文本 */
  function getQText(el) {
    const titleEl = el.querySelector('.title');
    if (titleEl) {
      return (titleEl.textContent || titleEl.innerText || '')
        .replace(/\(\d+分?\)/g, '')            // 去掉分值 (10分)
        .replace(/\s+/g, ' ')
        .trim();
    }
    // 兜底：提取全文本，去掉选项区域
    const clone = el.cloneNode(true);
    clone.querySelectorAll('input').forEach(inp => {
      const lab = inp.closest('label') || inp.parentElement;
      lab && lab.remove();
    });
    return clone.textContent
      .replace(/\s+/g, ' ').trim().substring(0, 300);
  }

  /** 找到页面上所有题目容器 */
  function findQContainers() {
    // MinuteStars 主策略：.answer 容器
    const ms = $$('.answer');
    if (ms.length > 0) return ms;

    // 通用策略：按 input name 分组，向上找题目容器
    const groups = new Map();
    $$('input[type="radio"],input[type="checkbox"]').forEach(inp => {
      if (!inp.name) return;
      if (!groups.has(inp.name)) groups.set(inp.name, []);
      groups.get(inp.name).push(inp);
    });
    return [...groups.values()].map(inps => {
      let el = inps[0].parentElement;
      for (let i = 0; i < 6 && el; el = el.parentElement, i++) {
        if (el.querySelectorAll('input[type="radio"],input[type="checkbox"]').length > 1) return el;
      }
      return inps[0].closest('li, .item, .question, fieldset') || inps[0].parentElement;
    }).filter(Boolean);
  }

  /** 多策略勾选（兼容自定义 UI 组件） */
  async function checkInput(input) {
    if (input.checked) return;
    // 必须用元素所属文档的 defaultView，避免 Tampermonkey sandbox window 与页面 window 不一致
    const pageWin = input.ownerDocument.defaultView;
    const rect = input.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;

    // --- 优先：触发 label（自定义组件的标准入口）---
    const label = input.closest('label') || (input.id ? pageWin.document.querySelector('label[for="'+input.id+'"]') : null);
    if (label) {
      label.click();
      for (const ev of ['mousedown','mouseup','click','pointerdown','pointerup','pointerclick']) {
        label.dispatchEvent(new MouseEvent(ev, { view: pageWin, bubbles:true, cancelable:true, clientX:cx, clientY:cy }));
      }
    }

    // --- 原生 input click + 全套事件（兜底）---
    input.click();
    for (const ev of ['mousedown','mouseup','click','pointerdown','pointerup']) {
      input.dispatchEvent(new MouseEvent(ev, { view: pageWin, bubbles:true, cancelable:true, clientX:cx, clientY:cy }));
    }
    input.dispatchEvent(new Event('change', { bubbles:true }));
    input.dispatchEvent(new Event('input',  { bubbles:true }));

    // --- disabled / hidden 时的父链兜底 ---
    if (input.disabled || input.type === 'hidden') {
      let p = input.parentElement;
      for (let i = 0; i < 4 && p; p = p.parentElement, i++) {
        if (getComputedStyle(p).cursor === 'pointer' || p.tagName === 'LABEL') {
          p.click();
          for (const ev of ['mousedown','mouseup','click','pointerdown','pointerup']) {
            p.dispatchEvent(new MouseEvent(ev, { view: pageWin, bubbles:true, cancelable:true, clientX:cx, clientY:cy }));
          }
          break;
        }
      }
    }

    await sleep(80);
    if (!input.checked) {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles:true }));
      input.dispatchEvent(new Event('input',  { bubbles:true }));
    }
  }

  async function uncheckInput(input) {
    if (!input.checked) return;
    const pageWin = input.ownerDocument.defaultView;
    const rect = input.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    input.click();
    for (const ev of ['mousedown','mouseup','click']) {
      input.dispatchEvent(new MouseEvent(ev, { view: pageWin, bubbles:true, cancelable:true, clientX:cx, clientY:cy }));
    }
    input.dispatchEvent(new Event('change', { bubbles:true }));
    await sleep(30);
    if (input.checked) { input.checked = false; input.dispatchEvent(new Event('change', {bubbles:true})); }
  }

  /** 根据答案字符串填写选项 */
  async function fill(container, answer) {
    const inputs = Array.from(container.querySelectorAll('input[type="radio"],input[type="checkbox"]'));
    if (!inputs.length) return false;
    const norm = s => (s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    /**
     * 提取选项文本：MinuteStars 结构为 <label><input ...> A. 对</label>
     * nextElementSibling 可能为 null（input 是 label 子节点时文字是 TextNode）
     */
    function getOptionText(inp) {
      // 直接取 label 的完整文本，去掉 input 本身（textContent 会跳过元素）
      const label = inp.closest('label') || inp.parentElement;
      if (!label) return inp.value || '';
      return label.textContent.replace(/\s+/g, ' ').trim();
    }

    // 判断题（answer 为 'true' / 'false' / true / false）
    if (answer === true || answer === 'true') {
      for (const i of inputs) {
        const txt = getOptionText(i).toLowerCase();
        if (txt.includes('对') || txt.includes('正确') || txt.includes('true') ||
            norm(i.value) === 'A' || norm(i.value) === '1' || norm(i.value) === 'T') {
          await checkInput(i); return true;
        }
      }
      // 兜底：选第一项（通常是"对"）
      await checkInput(inputs[0]); return true;
    }
    if (answer === false || answer === 'false') {
      for (const i of inputs) {
        const txt = getOptionText(i).toLowerCase();
        if (txt.includes('错') || txt.includes('错误') || txt.includes('false') ||
            norm(i.value) === 'B' || norm(i.value) === '0' || norm(i.value) === 'F') {
          await checkInput(i); return true;
        }
      }
      // 兜底：选最后一项（通常是"错"）
      await checkInput(inputs[inputs.length - 1]); return true;
    }

    // 单选/多选：answer 可以是 "A" / "A,B" / ["A","B"] 等
    // 关键：先 split 再 norm，防止 norm 先吞掉逗号导致 "A,D" → "AD"
    const letters = Array.isArray(answer)
      ? answer.map(norm)
      : String(answer).split(',').map(s => norm(s.trim())).filter(Boolean);

    for (const i of inputs) {
      const v    = norm(i.value);
      const txt  = getOptionText(i);
      const lbl1 = txt.trim().charAt(0).toUpperCase();
      // 同时匹配 value 和 label 首字母
      const shouldCheck = letters.includes(v)
        || (/[A-Z]/.test(lbl1) && letters.includes(lbl1));
      if (shouldCheck) { await checkInput(i); await sleep(30); }  // 每项间隔 30ms，确保事件顺序
      else if (i.type === 'checkbox' && i.checked) { await uncheckInput(i); await sleep(20); }
    }
    return true;
  }

  /* =========================================================
     提交试卷
  ========================================================= */
  /**
   * 保存答题（不交卷），用于答题中途保存进度
   */
  function doSave() {
    // MinuteStars 专属：#btnSavePapers（保存答题按钮）
    const saveBtn = $('#btnSavePapers');
    if (saveBtn) { uLog('💾 保存答题进度', 'ok'); saveBtn.click(); return; }
    uLog('⚠️ 未找到保存按钮', 'warn');
  }

  function doSubmit() {
    // 清理倒计时状态
    clearInterval(submitTickId);
    submitTickId = null;
    running = false;
    paused  = false;
    inCountdown = false;
    const pBtn = $('#ata-pause');
    if (pBtn) { pBtn.style.display = 'none'; pBtn.textContent = '⏸ 暂停'; pBtn.className = 'ata-btn yellow'; }
    
    const sels = [
      // MinuteStars 专属提交按钮（优先）
      '#btnSubmitPapers',
      // 通用备选
      '#btnSubmit','#btnSave','#btn_submit','#SubmitBtn',
      'input[id*="Submit"]','input[id*="submit"]','button[id*="Submit"]',
      'input[type="submit"]','button[type="submit"]',
      '.submit-btn','.btn-submit','[class*="submit"]',
      'input[value*="提交"]','button[value*="提交"]'
    ];
    for (const sel of sels) {
      const btn = $(sel);
      if (btn && !btn.disabled) { uLog('✅ 点击提交: ' + sel, 'ok'); btn.click(); return; }
    }
    // 文字匹配
    const btns = $$('input[type="submit"],input[type="button"],button,a.btn');
    for (const b of btns) {
      const t = (b.value || b.textContent || '').replace(/\s/g,'');
      if (['提交','交卷','完成','提交试卷','确认提交'].includes(t)) {
        uLog('提交: ' + t, 'ok'); b.click(); return;
      }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', ctrlKey:true, bubbles:true }));
    uLog('⚠️ 未找到提交按钮，尝试 Ctrl+Enter', 'warn');
  }

  /* =========================================================
     采集答案（从已批改答案页学习）
     适配 MinuteStars 结果页(viewanswer.aspx)专用结构：
     正确答案是容器底部 <div class="radio"> 汇总区中的
     <span class="answer-badge reference">正确答案</span>
     同级紧邻的 <span class="ml-l"> 文本
  ========================================================= */
  function collectAnswers() {
    uLog('开始采集答案…', 'info');
    const containers = findQContainers();
    let cnt = 0, skip = 0;
    containers.forEach(c => {
      const qText = getQText(c);
      if (!qText || qText.length < 4) { skip++; return; }

      /** 策略一：MinuteStars 结果页结构（高优先级） */
      const refBadge = c.querySelector('.answer-badge.reference');
      let answer = null;
      if (refBadge) {
        // 正确答案 = reference badge 后面紧邻的 .ml-l 元素
        let sibling = refBadge.nextElementSibling;
        while (sibling) {
          if (sibling.classList && sibling.classList.contains('ml-l')) {
            const txt = (sibling.textContent || '').trim().toUpperCase();
            if (/^[A-Z]$/.test(txt)) { answer = txt; break; }
            // .ml-l 里可能还有子 span，递归取直接文本
            const direct = Array.from(sibling.childNodes)
              .filter(n => n.nodeType === Node.TEXT_NODE)
              .map(n => n.textContent.trim().toUpperCase())
              .join('');
            if (/[A-Z]/.test(direct)) { answer = direct.match(/[A-Z]/)[0]; break; }
          }
          sibling = sibling.nextElementSibling;
        }
        // 兜底：reference badge 的父级 .mt-1 下的所有直接文本节点
        if (!answer) {
          const mt1 = refBadge.closest('.mt-1');
          if (mt1) {
            const direct = Array.from(mt1.childNodes)
              .filter(n => n.nodeType === Node.TEXT_NODE)
              .map(n => n.textContent.trim().toUpperCase())
              .join('');
            if (/[A-Z]/.test(direct)) answer = direct.match(/[A-Z]/)[0];
          }
        }
      }

      /** 策略二：其他批改页通用标记（无 reference badge 时退化） */
      if (!answer) {
        const inputs = Array.from(c.querySelectorAll('input[type="radio"],input[type="checkbox"]'));
        const correct = inputs.filter(i => {
          const p = i.closest('label,li,div,td,tr');
          if (!p) return false;
          if (i.getAttribute('data-correct') === 'true' || i.getAttribute('data-answer') === 'true') return true;
          const cls = (p.className || '').toLowerCase();
          if (/\b(correct|right|answer-right|true|正确)\b/.test(cls)) return true;
          const cs = getComputedStyle(p);
          const tc = cs.color;
          if (/^rgb\(\s*0\s*,\s*(?:6\d|7\d|8\d|9\d|1[012]\d)\s*,\s*0\s*\)$/.test(tc)) return true;
          if (/^rgb\(\s*0\s*,\s*(?:1[2-9]\d|2\d{2})\s*,\s*(?:0|6\d|7\d|8\d)\s*\)$/.test(tc)) return true;
          return false;
        });
        if (correct.length > 0) {
          answer = correct.map(inp => {
            const v = (inp.value || '').trim().toUpperCase();
            if (/^[A-Z]$/.test(v)) return v;
            const label = inp.closest('label') || inp.parentElement;
            const lbl = label ? label.textContent.trim().charAt(0).toUpperCase() : '';
            return /[A-Z]/.test(lbl) ? lbl : v;
          }).filter(Boolean).join(',');
        }
      }

      if (!answer) { skip++; return; }

      // 去重
      const db  = LibraryManager.load();
      const nq  = cleanText(qText);
      const dup = Object.keys(db).some(k => cleanText(k) === nq);
      if (!dup) {
        LibraryManager.add(qText, answer);
        cnt++;
      } else {
        skip++;
      }
    });
    uLog('采集完成，新增 ' + cnt + ' 条，跳过 ' + skip + ' 条', cnt > 0 ? 'ok' : 'warn');
    refreshLibCount();
    refreshStats();
  }

  /* =========================================================
     扫描结构（调试）
  ========================================================= */
  function debugScan() {
    const containers = findQContainers();
    const info = [
      'URL: ' + location.href,
      '题目容器数: ' + containers.length,
      'radio/checkbox 总数: ' + $$('input[type=radio],input[type=checkbox]').length,
      '提交按钮: ' + $$('input[type=submit],button[type=submit]').map(b => b.value || b.textContent).join(' | ')
    ];
    if (containers.length > 0) {
      const q0Text = getQText(containers[0]);
      info.push('--- 第1题预览 ---', '题干: ' + q0Text.substring(0, 100));
    }
    const report = info.join('\n');
    console.log('[ATA Pro DEBUG]\n' + report);
    uLog(report.replace(/\n/g, ' | ').substring(0, 300), 'info');
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border:1px solid #ccc;border-radius:8px;padding:20px;z-index:2147483646;max-width:80vw;max-height:80vh;overflow:auto;font-size:12px;white-space:pre;box-shadow:0 4px 20px rgba(0,0,0,.3);';
    div.textContent = report;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭'; closeBtn.style.cssText = 'position:absolute;top:8px;right:8px;padding:3px 10px;cursor:pointer;border:1px solid #ccc;border-radius:4px;';
    closeBtn.onclick = () => div.remove();
    div.appendChild(closeBtn);
    document.body.appendChild(div);
  }

  /* =========================================================
     主答题流程
  ========================================================= */
  let running = false;
  let paused  = false;
  let inCountdown = false;  // 是否处于提交倒计时阶段
  let submitTickId = null;  // 提交倒计时 interval ID
  let submitRem    = 0;     // 提交倒计时剩余秒数

  async function runAutoAnswer() {
    if (running) { uLog('已在运行，请勿重复点击', 'warn'); return; }
    running = true;
    paused  = false;
    inCountdown = false;
    const pauseBtn = $('#ata-pause');
    if (pauseBtn) { pauseBtn.style.display = ''; pauseBtn.textContent = '⏸ 暂停'; pauseBtn.className = 'ata-btn yellow'; }
    setRunningStatus('答题中…', 'running');
    uLog('=== 开始自动答题 ===', 'ok');

    try {
      const containers = findQContainers();
      uLog('找到 ' + containers.length + ' 个题目容器', 'info');
      if (!containers.length) {
        uLog('未找到题目！请点 "扫描结构" 查看页面情况', 'err');
        setRunningStatus('❌ 未找到题目', 'idle');
        running = false; return;
      }

      // 更新总题数统计卡
      const statTotalEl = $('#ata-stat-total');
      if (statTotalEl) statTotalEl.textContent = containers.length;

      setProgress(0, containers.length);
      let ok = 0, skip = 0, infer = 0;
      const seenQ = new Set();

      for (let i = 0; i < containers.length; i++) {
        if (!running) break;
        const c   = containers[i];
        const txt = getQText(c);
        const nq  = cleanText(txt);
        if (seenQ.has(nq)) { skip++; continue; }
        seenQ.add(nq);

        const ans = findMatch(txt);
        if (ans !== null) {
          await fill(c, ans);
          c.classList.add('ata-answered');
          const ansStr = Array.isArray(ans) ? ans.join('') : String(ans);
          uLog('✅ ' + txt.substring(0, 35) + '… → ' + ansStr, 'ok');
          ok++;
        } else {
          // 尝试规则推断
          const inputs = Array.from(c.querySelectorAll('input[type="radio"],input[type="checkbox"]'));
          const ruleAns = ruleInfer(txt, inputs);
          if (ruleAns) {
            await fill(c, ruleAns);
            c.classList.add('ata-answered');
            uLog('🔎 规则推断 ' + txt.substring(0, 30) + '… → ' + ruleAns, 'info');
            infer++;
          } else {
            c.classList.add('ata-no-match');
            uLog('⏭ 未匹配: ' + txt.substring(0, 40), 'warn');
            skip++;
          }
        }

        // 实时更新统计卡片（每题都更新）
        const pct = Math.round((i + 1) / containers.length * 100);
        setProgress(i + 1, containers.length);
        const statAns = $('#ata-stat-answered');
        const statHit = $('#ata-stat-hit');
        const statMiss = $('#ata-stat-miss');
        if (statAns)  statAns.textContent  = i + 1;
        if (statHit)  statHit.textContent   = ok + infer;
        if (statMiss) statMiss.textContent  = skip;
        setRunningStatus('答题中 ' + (i+1) + '/' + containers.length + ' 题 ' + pct + '%', 'running');

        // 暂停时阻塞，直到用户点继续
        while (paused && running) {
          setRunningStatus('⏸ 已暂停 ' + (i+1) + '/' + containers.length + ' 题 ' + pct + '%', 'running');
          await sleep(300);
        }
        if (!running) break;

        await sleep(CFG.answerDelay + Math.random() * 200);
      }

      uLog('完成！命中 ' + ok + '，推断 ' + infer + '，跳过 ' + skip, 'ok');
      setRunningStatus('✅ 完成！命中' + (ok+infer) + '题', 'done');

      if (CFG.autoSubmit) {
        const [minS, maxS] = [CFG.submitDelayMin, CFG.submitDelayMax];
        submitRem = minS + Math.floor(Math.random() * (maxS - minS + 1));
        uLog('⏳ ' + submitRem + ' 秒后自动提交…（可暂停倒计时）', 'warn');
        inCountdown = true;
        const pBtn = $('#ata-pause');
        if (pBtn) {
          pBtn.style.display = '';
          pBtn.textContent = '⏸ 暂停倒计时';
          pBtn.className = 'ata-btn orange';
        }
        const startTick = () => {
          clearInterval(submitTickId);
          submitTickId = setInterval(() => {
            if (paused) {
              // 暂停时每秒刷新剩余秒数显示
              if (inCountdown && submitRem > 0) {
                setRunningStatus('⏸ 倒计时已暂停（剩余 ' + submitRem + 's）', 'running');
              }
              return;
            }
            submitRem--;
            if (inCountdown) {
              setRunningStatus('⏳ ' + submitRem + ' 秒后提交…', 'running');
            }
            if (submitRem <= 0) {
              clearInterval(submitTickId);
              submitTickId = null;
              doSubmit();
            }
          }, 1000);
        };
        startTick();
      }
    } catch (e) {
      uLog('运行出错: ' + e.message, 'err');
      setRunningStatus('❌ 出错', 'idle');
      console.error(e);
      // 出错时也要清理倒计时状态
      clearInterval(submitTickId);
      submitTickId = null;
      running = false;
      paused  = false;
      inCountdown = false;
      const pBtn = $('#ata-pause');
      if (pBtn) { pBtn.style.display = 'none'; pBtn.textContent = '⏸ 暂停'; pBtn.className = 'ata-btn yellow'; }
    }
  }

  /* =========================================================
     设置面板 UI 逻辑
  ========================================================= */

  /** 将 CFG 当前值同步渲染到面板控件 */
  function syncSettingsUI() {
    const ge = id => document.getElementById(id);
    const setChk = (id, v) => { const el = ge(id); if (el) el.checked = !!v; };
    const setVal = (id, v) => { const el = ge(id); if (el) el.value = v; };

    setChk('cfg-fuzzy-enable',  CFG.fuzzyEnable);
    setVal('cfg-fuzzy-thresh',  Math.round(CFG.fuzzyThresh * 100));
    setVal('cfg-thresh-val',    Math.round(CFG.fuzzyThresh * 100) + '%');
    const hintEl = ge('cfg-fuzzy-hint');
    if (hintEl) { hintEl.textContent = CFG.fuzzyEnable ? '开' : '关'; hintEl.style.color = CFG.fuzzyEnable ? '#66bb6a' : '#ef5350'; }
    const threshRow = ge('cfg-fuzzy-thresh-row');
    if (threshRow) threshRow.style.opacity = CFG.fuzzyEnable ? '1' : '.4';

    setChk('cfg-auto-answer', CFG.autoAnswer);
    setChk('cfg-auto-submit', CFG.autoSubmit);
    setVal('cfg-answer-delay', CFG.answerDelay);
    setVal('cfg-submit-min',   CFG.submitDelayMin);
    setVal('cfg-submit-max',   CFG.submitDelayMax);
    const sdRow = ge('cfg-submit-delay-row');
    if (sdRow) sdRow.style.opacity = CFG.autoSubmit ? '1' : '.4';

    setChk('cfg-auto-login',  CFG.autoLogin);
    setVal('cfg-username',    CFG.username);
    setVal('cfg-password',    CFG.password);
    const loginFields = ge('cfg-login-fields');
    if (loginFields) loginFields.style.opacity = CFG.autoLogin ? '1' : '.4';

    setChk('cfg-debug', CFG.debug);
  }

  /** 从面板控件读取当前值写入 CFG 并持久化 */
  function applySettingsFromUI() {
    const ge  = id => document.getElementById(id);
    const gChk = id => { const el = ge(id); return el ? el.checked : false; };
    const gVal = id => { const el = ge(id); return el ? el.value : ''; };

    CFG.fuzzyEnable     = gChk('cfg-fuzzy-enable');
    CFG.fuzzyThresh     = parseInt(gVal('cfg-fuzzy-thresh'), 10) / 100;
    CFG.autoAnswer      = gChk('cfg-auto-answer');
    CFG.autoSubmit      = gChk('cfg-auto-submit');
    CFG.answerDelay     = Math.max(0, parseInt(gVal('cfg-answer-delay'), 10) || 120);
    CFG.submitDelayMin  = Math.max(5, parseInt(gVal('cfg-submit-min'), 10) || 40);
    CFG.submitDelayMax  = Math.max(CFG.submitDelayMin + 5, parseInt(gVal('cfg-submit-max'), 10) || 120);
    CFG.autoLogin       = gChk('cfg-auto-login');
    CFG.username        = gVal('cfg-username').trim();
    CFG.password        = gVal('cfg-password');
    CFG.debug           = gChk('cfg-debug');
    saveCFG();
  }

  // 折叠展开
  const settingsHd   = document.getElementById('ata-settings-hd');
  const settingsBody = document.getElementById('ata-settings-body');
  const settingsArrow = document.getElementById('ata-settings-arrow');
  settingsHd.addEventListener('click', () => {
    const open = settingsBody.classList.toggle('open');
    settingsArrow.textContent = open ? '▲' : '▼';
    if (open) syncSettingsUI();
  });

  // 模糊匹配开关
  document.getElementById('cfg-fuzzy-enable').addEventListener('change', function () {
    const hintEl  = document.getElementById('cfg-fuzzy-hint');
    const threshRow = document.getElementById('cfg-fuzzy-thresh-row');
    hintEl.textContent = this.checked ? '开' : '关';
    hintEl.style.color = this.checked ? '#66bb6a' : '#ef5350';
    if (threshRow) threshRow.style.opacity = this.checked ? '1' : '.4';
  });

  // 阈值滑块实时更新数值
  document.getElementById('cfg-fuzzy-thresh').addEventListener('input', function () {
    const el = document.getElementById('cfg-thresh-val');
    if (el) el.textContent = this.value + '%';
  });

  // 自动提交开关 → 延迟行的可用状态
  document.getElementById('cfg-auto-submit').addEventListener('change', function () {
    const row = document.getElementById('cfg-submit-delay-row');
    if (row) row.style.opacity = this.checked ? '1' : '.4';
  });

  // 自动登录开关 → 账密区的可用状态
  document.getElementById('cfg-auto-login').addEventListener('change', function () {
    const fields = document.getElementById('cfg-login-fields');
    if (fields) fields.style.opacity = this.checked ? '1' : '.4';
  });

  // 密码显隐
  document.getElementById('cfg-eye').addEventListener('click', () => {
    const inp = document.getElementById('cfg-password');
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // 保存
  document.getElementById('cfg-save').addEventListener('click', () => {
    applySettingsFromUI();
    const msg = document.getElementById('cfg-save-msg');
    if (msg) { msg.textContent = '✅ 设置已保存'; setTimeout(() => { msg.textContent = ''; }, 2500); }
    uLog('⚙ 设置已保存（模糊匹配:' + (CFG.fuzzyEnable ? '开 阈值' + Math.round(CFG.fuzzyThresh*100) + '%' : '关') + ' 自动登录:' + (CFG.autoLogin ? '开' : '关') + '）', 'ok');
  });

  // 恢复默认
  document.getElementById('cfg-reset-defaults').addEventListener('click', () => {
    if (!confirm('恢复所有设置为默认值？（账号密码也会清空）')) return;
    Object.assign(CFG, CFG_DEFAULT);
    saveCFG();
    syncSettingsUI();
    const msg = document.getElementById('cfg-save-msg');
    if (msg) { msg.textContent = '↺ 已恢复默认'; setTimeout(() => { msg.textContent = ''; }, 2500); }
  });

  /* =========================================================
     按钮事件绑定
  ========================================================= */
  $('#ata-start').addEventListener('click', runAutoAnswer);

  $('#ata-pause').addEventListener('click', () => {
    const btn = $('#ata-pause');
    if (!btn) return;
    // 答题阶段需要 running=true；倒计时阶段只需要 inCountdown=true
    if (!running && !inCountdown) return;
    if (!paused) {
      // 暂停
      paused = true;
      if (inCountdown) {
        btn.textContent = '▶ 继续倒计时';
        btn.className = 'ata-btn orange';
        setRunningStatus('⏸ 倒计时已暂停（剩余 ' + submitRem + 's）', 'running');
        uLog('⏸ 倒计时已暂停（可再次点击继续）', 'warn');
      } else {
        btn.textContent = '▶ 继续';
        btn.className = 'ata-btn green';
        setRunningStatus('⏸ 已暂停', 'running');
        uLog('⏸ 已暂停（可再次点击继续）', 'warn');
      }
    } else {
      // 继续
      paused = false;
      if (inCountdown) {
        btn.textContent = '⏸ 暂停倒计时';
        btn.className = 'ata-btn orange';
        uLog('▶ 继续倒计时', 'ok');
      } else {
        btn.textContent = '⏸ 暂停';
        btn.className = 'ata-btn yellow';
        uLog('▶ 继续答题', 'ok');
      }
    }
  });

  $('#ata-stop').addEventListener('click', () => {
    running = false;
    paused  = false;
    inCountdown = false;
    clearInterval(submitTickId);
    submitTickId = null;
    const btn = $('#ata-pause');
    if (btn) { btn.style.display = 'none'; btn.textContent = '⏸ 暂停'; btn.className = 'ata-btn yellow'; }
    setRunningStatus('已停止', 'idle');
    uLog('已手动停止', 'warn');
  });
  $('#ata-submit').addEventListener('click', doSubmit);
  $('#ata-scan').addEventListener('click', debugScan);
  $('#ata-collect').addEventListener('click', collectAnswers);
  $('#ata-reset').addEventListener('click', () => {
    $$('input').forEach(i => { i.checked = false; i.dispatchEvent(new Event('change', {bubbles:true})); });
    $$('.ata-answered,.ata-no-match').forEach(e => e.classList.remove('ata-answered','ata-no-match'));
    setProgress(0, 1);
    setRunningStatus('等待开始', 'idle');
    ['ata-stat-total','ata-stat-answered','ata-stat-hit','ata-stat-miss'].forEach(id => {
      const el = $(id); if (el) el.textContent = '0';
    });
    running = false; paused = false; inCountdown = false;
    clearInterval(submitTickId); submitTickId = null;
    const pBtn = $('#ata-pause');
    if (pBtn) { pBtn.style.display = 'none'; pBtn.textContent = '⏸ 暂停'; pBtn.className = 'ata-btn yellow'; }
    uLog('已重置', 'info');
  });
  $('#ata-close').addEventListener('click', () => { panel.style.display = 'none'; });

  $('#ata-collapse-panel').addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    $('#ata-collapse-panel').textContent = collapsed ? '▲' : '▼';
    $('#ata-collapse-panel').title = collapsed ? '展开面板' : '收起面板';
  });

  $('#ata-expand-btn').addEventListener('click', () => {
    panel.classList.remove('collapsed');
    $('#ata-collapse-panel').textContent = '▼';
    $('#ata-collapse-panel').title = '收起面板';
  });

  /* =========================================================
     手动调整面板大小
  ========================================================= */
  let resizing = false, rStartX = 0, rStartY = 0, rStartW = 0, rStartH = 0;
  const resizeHandle = $('#ata-resize-handle');
  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', e => {
      resizing = true;
      rStartX = e.clientX; rStartY = e.clientY;
      rStartW = panel.offsetWidth; rStartH = panel.offsetHeight;
      e.preventDefault(); e.stopPropagation();
    });
    document.addEventListener('mousemove', e => {
      if (!resizing) return;
      const newW = Math.max(280, rStartW + (e.clientX - rStartX));
      const newH = Math.max(200, rStartH + (e.clientY - rStartY));
      panel.style.width = newW + 'px';
      panel.style.height = newH + 'px';
    });
    document.addEventListener('mouseup', () => { resizing = false; });
  }

  /* =========================================================
     拖拽面板
  ========================================================= */
  let drag = false, _dx = 0, _dy = 0;
  panel.addEventListener('mousedown', e => {
    if (!['INPUT','TEXTAREA','BUTTON','SELECT'].includes(e.target.tagName)) {
      drag = true; _dx = e.clientX - panel.offsetLeft; _dy = e.clientY - panel.offsetTop;
    }
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    panel.style.left  = (e.clientX - _dx) + 'px';
    panel.style.top   = (e.clientY - _dy) + 'px';
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => { drag = false; });

  /* =========================================================
     初始化：检测题目数量
  ========================================================= */
  refreshLibCount();
  setTimeout(() => {
    const qs = findQContainers();
    if (qs.length) {
      uLog('页面就绪，检测到 ' + qs.length + ' 题', 'ok');
      const statTotalEl = $('#ata-stat-total');
      if (statTotalEl) statTotalEl.textContent = qs.length;
      setRunningStatus('✅ ' + qs.length + ' 题已就绪', 'idle');
    } else {
      uLog('暂未检测到题目，等待页面加载…', 'warn');
      setRunningStatus('等待页面加载…', 'idle');
    }
    if (CFG.autoAnswer) {
      uLog('3 秒后自动开始…', 'warn');
      setTimeout(runAutoAnswer, 3000);
    }
  }, 1500);

})();

