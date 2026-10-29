using System;
using System.IO;
using System.Drawing;
using System.Windows.Forms;
class DesktopTest {
  [STAThread] static void Main(string[] args) {
    Application.EnableVisualStyles();var form=new Form{Text="Remote Ops Desktop Acceptance",Width=640,Height=320,StartPosition=FormStartPosition.CenterScreen};
    var input=new TextBox{Name="InputText",AccessibleName="Input text",Left=24,Top=32,Width=560,Text=""};
    var save=new Button{Name="SaveButton",Text="Save",Left=24,Top=96,Width=120};
    var result=new Label{Name="SaveCount",Text="Saved 0",Left=24,Top=156,Width=560};int count=0;
    save.Click+=(s,e)=>{File.WriteAllText(args[0],input.Text,new System.Text.UTF8Encoding(false));result.Text="Saved "+(++count);};
    form.Controls.AddRange(new Control[]{input,save,result});Application.Run(form);
  }
}
